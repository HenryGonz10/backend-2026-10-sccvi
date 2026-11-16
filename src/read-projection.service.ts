import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Client } from '@elastic/elasticsearch';
import { Collection, MongoClient } from 'mongodb';
import { In, Repository } from 'typeorm';
import { AlertaVacunacion, EsquemaDosis, MedicionAntropometrica, Menor, MenorResponsable, RegistroVacunacion, Vacuna } from './entities';
import { SsoClient } from './integrations';
import { SsoServiceTokenService } from './sso-service-token.service';

export type MinorReadDocument = {
  _id: string; minor_id: string; persona_id: string;
  persona: { cui: string | null; nombre: string | null; fecha_nacimiento: string | null };
  departamento_codigo: string | null; municipio_codigo: string | null; comunidad_ref: string | null; estado: boolean; observaciones: string | null;
  responsables: Array<{ persona_id: string; tipo_relacion: string }>;
  vacunas: Array<{ esquema_dosis_id: string; vacuna_id: string | null; codigo: string | null; nombre: string | null; fecha_aplicacion: string; estado: string }>;
  pendientes_vacuna_codigos: string[]; ultima_vacuna_fecha: string | null;
  mediciones: Array<{ fecha: string; peso_kg: string; talla_cm: string; imc: string }>;
  alertas: Array<{ tipo: string; fecha_programada: string; estado: string }>;
  tokens: string[]; projection_version: string; projected_at: string;
};

export type MinorSearchFilters = {
  q?: string; cui?: string; fecha_nacimiento?: string; vacuna_codigo?: string; estado_vacuna?: 'APLICADA' | 'FALTA';
  ultima_vacuna_desde?: string; ultima_vacuna_hasta?: string; alerta_tipo?: string;
  departamento_codigo?: string; municipio_codigo?: string; page?: number; per_page?: number;
};

const tokenize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2);

/**
 * SQL Server is authoritative. MongoDB holds a denormalized operational read
 * model and Elasticsearch performs pagination/search. Identity fields arrive
 * from SSO only in this protected read model, never in the public vaccination card.
 */
@Injectable()
export class SccviReadProjectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SccviReadProjectionService.name);
  private mongo?: MongoClient; private collection?: Collection<MinorReadDocument>; private elastic?: Client; private timer?: NodeJS.Timeout;
  private readonly index = 'sccvi-minors-v1';
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Menor) private readonly minors: Repository<Menor>,
    @InjectRepository(MenorResponsable) private readonly responsables: Repository<MenorResponsable>,
    @InjectRepository(RegistroVacunacion) private readonly vaccinations: Repository<RegistroVacunacion>,
    @InjectRepository(MedicionAntropometrica) private readonly measurements: Repository<MedicionAntropometrica>,
    @InjectRepository(AlertaVacunacion) private readonly alerts: Repository<AlertaVacunacion>,
    @InjectRepository(EsquemaDosis) private readonly doses: Repository<EsquemaDosis> = {} as Repository<EsquemaDosis>,
    @InjectRepository(Vacuna) private readonly vaccines: Repository<Vacuna> = {} as Repository<Vacuna>,
    private readonly sso: SsoClient = {} as SsoClient, private readonly serviceTokens: SsoServiceTokenService = {} as SsoServiceTokenService,
  ) {}

  async onModuleInit() { await this.connect(); this.timer = setInterval(() => void this.rebuild().catch(error => this.logger.error('Read projection rebuild failed.', error)), 60_000); this.timer.unref(); void this.rebuild().catch(error => this.logger.error('Initial read projection rebuild failed.', error)); }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.mongo?.close().catch(() => undefined); }
  async rebuild(batchSize = 250) {
    if (!await this.connect()) return 0;
    let skip = 0; let total = 0;
    for (;;) { const rows = await this.minors.find({ order: { id: 'ASC' }, skip, take: batchSize }); if (!rows.length) return total; await Promise.all(rows.map(minor => this.project(minor.id))); total += rows.length; if (rows.length < batchSize) return total; skip += rows.length; }
  }

  async project(minorId: string): Promise<void> {
    if (!await this.connect()) return;
    const minor = await this.minors.findOneBy({ id: minorId });
    if (!minor) { await this.collection?.deleteOne({ _id: minorId }); await this.elastic?.delete({ index: this.index, id: minorId }, { ignore: [404] }).catch(() => undefined); return; }
    const [responsables, applications, mediciones, alerts, people] = await Promise.all([
      this.responsables.find({ where: { menor_id: minorId, estado: true }, order: { id: 'ASC' } }),
      this.vaccinations.find({ where: { menor_id: minorId }, order: { fecha_aplicacion: 'DESC' } }),
      this.measurements.find({ where: { menor_id: minorId }, order: { fecha: 'DESC' } }),
      this.alerts.find({ where: { menor_id: minorId }, order: { fecha_programada: 'ASC' } }),
      this.sso.resolvePeople([minor.persona_id], await this.serviceTokens.get()).catch(() => []),
    ]);
    const doseIds = [...new Set([...applications.map(item => item.esquema_dosis_id), ...alerts.map(item => item.esquema_dosis_id)])];
    const doseRows = doseIds.length ? await this.doses.findBy({ id: In(doseIds) }) : [];
    const doseById = new Map(doseRows.map(item => [item.id, item])); const vaccineIds = [...new Set(doseRows.map(item => item.vacuna_id))];
    const vaccineRows = vaccineIds.length ? await this.vaccines.findBy({ id: In(vaccineIds) }) : []; const vaccineById = new Map(vaccineRows.map(item => [item.id, item]));
    const person = people[0]; const applicationRows = applications.map(item => { const dose = doseById.get(item.esquema_dosis_id); const vaccine = dose ? vaccineById.get(dose.vacuna_id) : undefined; return { esquema_dosis_id: item.esquema_dosis_id, vacuna_id: vaccine?.id ?? null, codigo: vaccine?.codigo ?? null, nombre: vaccine?.nombre ?? null, fecha_aplicacion: item.fecha_aplicacion, estado: item.estado }; });
    const pendingCodes = [...new Set(alerts.filter(item => item.estado === 'PENDIENTE').map(item => { const dose = doseById.get(item.esquema_dosis_id); return dose ? vaccineById.get(dose.vacuna_id)?.codigo ?? null : null; }).filter((value): value is string => Boolean(value)))];
    const tokens = [...new Set([minor.persona_id, person?.cui, person?.ncompleto, person?.fecha_nacimiento, minor.departamento_codigo, minor.municipio_codigo, minor.comunidad_ref, minor.observaciones, ...responsables.flatMap(item => [item.persona_id, item.tipo_relacion]), ...applicationRows.flatMap(item => [item.codigo, item.nombre, item.estado]), ...pendingCodes, ...alerts.flatMap(item => [item.tipo, item.estado])].flatMap(tokenize))];
    const document: MinorReadDocument = { _id: minor.id, minor_id: minor.id, persona_id: minor.persona_id, persona: { cui: person?.cui ?? null, nombre: person?.ncompleto ?? null, fecha_nacimiento: person?.fecha_nacimiento ?? null }, departamento_codigo: minor.departamento_codigo, municipio_codigo: minor.municipio_codigo, comunidad_ref: minor.comunidad_ref, estado: minor.estado, observaciones: minor.observaciones, responsables: responsables.map(item => ({ persona_id: item.persona_id, tipo_relacion: item.tipo_relacion })), vacunas: applicationRows, pendientes_vacuna_codigos: pendingCodes, ultima_vacuna_fecha: applicationRows[0]?.fecha_aplicacion ?? null, mediciones: mediciones.map(item => ({ fecha: item.fecha, peso_kg: item.peso_kg, talla_cm: item.talla_cm, imc: item.imc })), alertas: alerts.map(item => ({ tipo: item.tipo, fecha_programada: item.fecha_programada, estado: item.estado })), tokens, projection_version: `${minor.version}:${minor.updated_at.toISOString()}`, projected_at: new Date().toISOString() };
    await this.collection!.updateOne({ _id: minor.id }, { $set: document }, { upsert: true });
    const searchDocument = Object.fromEntries(Object.entries(document).filter(([key]) => key !== '_id'));
    await this.elastic!.index({ index: this.index, id: minor.id, document: searchDocument, refresh: false });
  }

  async list(filters: Pick<MinorSearchFilters, 'departamento_codigo' | 'municipio_codigo' | 'page' | 'per_page'>) { return this.search(filters); }
  async search(input: MinorSearchFilters | string, legacyPage?: number, legacyPerPage?: number) {
    if (!await this.connect()) throw new ServiceUnavailableException('La búsqueda clínica SCCVI no está disponible.');
    const filters: MinorSearchFilters = typeof input === 'string' ? { q: input, page: legacyPage, per_page: legacyPerPage } : input;
    const current_page = Math.max(1, Number(filters.page) || 1); const size = Math.min(100, Math.max(1, Number(filters.per_page) || 25)); const terms = tokenize(filters.q);
    const exact = filters.cui ? tokenize(filters.cui) : []; const allTokens = [...new Set([...terms, ...exact])];
    const elasticFilters: object[] = [{ term: { estado: true } }];
    if (filters.departamento_codigo) elasticFilters.push({ term: { departamento_codigo: filters.departamento_codigo } });
    if (filters.municipio_codigo) elasticFilters.push({ term: { municipio_codigo: filters.municipio_codigo } });
    if (filters.fecha_nacimiento) elasticFilters.push({ term: { 'persona.fecha_nacimiento': filters.fecha_nacimiento } });
    if (filters.vacuna_codigo && filters.estado_vacuna === 'FALTA') elasticFilters.push({ term: { 'pendientes_vacuna_codigos': filters.vacuna_codigo } });
    if (filters.vacuna_codigo && filters.estado_vacuna !== 'FALTA') elasticFilters.push({ nested: { path: 'vacunas', query: { bool: { filter: [{ term: { 'vacunas.codigo': filters.vacuna_codigo } }, ...(filters.estado_vacuna === 'APLICADA' ? [{ term: { 'vacunas.estado': 'VALIDA' } }] : [])] } } } });
    if (filters.alerta_tipo) elasticFilters.push({ nested: { path: 'alertas', query: { term: { 'alertas.tipo': filters.alerta_tipo } } } });
    if (filters.ultima_vacuna_desde || filters.ultima_vacuna_hasta) elasticFilters.push({ range: { ultima_vacuna_fecha: { ...(filters.ultima_vacuna_desde ? { gte: filters.ultima_vacuna_desde } : {}), ...(filters.ultima_vacuna_hasta ? { lte: filters.ultima_vacuna_hasta } : {}) } } });
    // `tokens` is a protected keyword index. Prefix matching keeps identity
    // lookup useful while a clinician types a name or a CUI, without relying
    // on a public full-text index.
    const response = await this.elastic!.search({ index: this.index, from: (current_page - 1) * size, size, query: { bool: { filter: elasticFilters, must: allTokens.map(token => ({ prefix: { tokens: token } })) } }, sort: [{ ultima_vacuna_fecha: { order: 'desc', missing: '_last' } }, { minor_id: { order: 'asc' } }] });
    const ids = response.hits.hits.map(hit => String(hit._id)); const docs = await this.collection!.find({ _id: { $in: ids } }).toArray(); const byId = new Map(docs.map(doc => [doc._id, doc])); const items = ids.map(id => byId.get(id)).filter((value): value is MinorReadDocument => Boolean(value));
    const total = response.hits.total && typeof response.hits.total === 'object' ? response.hits.total.value : ids.length;
    return { items, meta: { current_page, per_page: size, total, last_page: Math.max(1, Math.ceil(total / size)) } };
  }

  private async connect(): Promise<boolean> {
    try {
      if (!this.collection) { this.mongo = new MongoClient(this.config.get('MONGO_URL', 'mongodb://mongo:27017/?replicaSet=rs0')); await this.mongo.connect(); this.collection = this.mongo.db(this.config.get('MONGO_DATABASE', 'sccvi-read')).collection<MinorReadDocument>('minor_projections'); await this.collection.createIndex({ estado: 1, departamento_codigo: 1, municipio_codigo: 1, ultima_vacuna_fecha: -1 }); }
      if (!this.elastic) { this.elastic = new Client({ node: this.config.get('ELASTICSEARCH_NODE', 'http://elasticsearch:9200') }); const exists = await this.elastic.indices.exists({ index: this.index }); if (!exists) await this.elastic.indices.create({ index: this.index, mappings: { properties: { minor_id: { type: 'keyword' }, persona_id: { type: 'keyword' }, estado: { type: 'boolean' }, departamento_codigo: { type: 'keyword' }, municipio_codigo: { type: 'keyword' }, tokens: { type: 'keyword' }, ultima_vacuna_fecha: { type: 'date', format: 'yyyy-MM-dd' }, pendientes_vacuna_codigos: { type: 'keyword' }, vacunas: { type: 'nested', properties: { codigo: { type: 'keyword' }, fecha_aplicacion: { type: 'date', format: 'yyyy-MM-dd' }, estado: { type: 'keyword' } } }, alertas: { type: 'nested', properties: { tipo: { type: 'keyword' }, fecha_programada: { type: 'date', format: 'yyyy-MM-dd' }, estado: { type: 'keyword' } } } } } }); }
      return true;
    } catch (error) { this.logger.warn(`Read projections unavailable; clinical writes remain online: ${String(error)}`); return false; }
  }
}
