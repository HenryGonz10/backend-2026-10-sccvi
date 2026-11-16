import { BadGatewayException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import { In, ObjectLiteral, Repository } from 'typeorm';
import { AlertaVacunacion, AuditoriaSccvi, CarnePublico, EsquemaDosis, EsquemaVacunacion, JornadaVacunacion, JornadaVacuna, MedicionAntropometrica, Menor, MenorResponsable, RegistroVacunacion, Vacuna } from './entities';
import { AplicacionDto, DosisDto, EsquemaDto, FamiliaRegistroDto, FamiliaResponsableDto, JornadaDto, MedicionDto, MenorDto, MenorQueryDto, PageDto, PersonaSearchDto, ResponsableDto, UpdateEsquemaDto, UpdateJornadaDto, UpdateMenorDto, UpdateResponsableDto, UpdateVacunaDto, VacunaDto } from './dto';
import { GeoClient, SsoClient } from './integrations';
import { OutboxService } from './outbox.service';
import { SccviReadProjectionService } from './read-projection.service';
import { ProjectionOutboxService } from './projection-outbox.service';
import { SsoServiceTokenService } from './sso-service-token.service';
import { SccviPrincipal } from './sso-jwt.guard';

type Page<T> = { items: T[]; meta: { current_page: number; per_page: number; total: number; last_page: number } };

@Injectable()
export class SccviService {
  constructor(
    @InjectRepository(Menor) private readonly menores: Repository<Menor>,
    @InjectRepository(MenorResponsable) private readonly responsables: Repository<MenorResponsable>,
    @InjectRepository(Vacuna) private readonly vacunas: Repository<Vacuna>,
    @InjectRepository(EsquemaVacunacion) private readonly esquemas: Repository<EsquemaVacunacion>,
    @InjectRepository(EsquemaDosis) private readonly dosis: Repository<EsquemaDosis>,
    @InjectRepository(RegistroVacunacion) private readonly registros: Repository<RegistroVacunacion>,
    @InjectRepository(MedicionAntropometrica) private readonly mediciones: Repository<MedicionAntropometrica>,
    @InjectRepository(JornadaVacunacion) private readonly jornadas: Repository<JornadaVacunacion>,
    @InjectRepository(JornadaVacuna) private readonly jornadaVacunas: Repository<JornadaVacuna>,
    @InjectRepository(AlertaVacunacion) private readonly alertas: Repository<AlertaVacunacion>,
    @InjectRepository(AuditoriaSccvi) private readonly auditoria: Repository<AuditoriaSccvi>,
    private readonly sso: SsoClient, private readonly geo: GeoClient, private readonly outbox: OutboxService, private readonly config: ConfigService, private readonly readProjection: SccviReadProjectionService, private readonly projectionOutbox: ProjectionOutboxService, private readonly serviceTokens: SsoServiceTokenService, @InjectRepository(CarnePublico) private readonly carnesPublicos: Repository<CarnePublico> = {} as Repository<CarnePublico>,
  ) {}

  private async page<T extends ObjectLiteral>(repo: Repository<T>, page: PageDto, where?: object): Promise<Page<T>> {
    const [items, total] = await repo.findAndCount({ where: where as never, skip: (page.page - 1) * page.per_page, take: page.per_page, order: { id: 'ASC' } as never });
    return { items, meta: { current_page: page.page, per_page: page.per_page, total, last_page: Math.max(1, Math.ceil(total / page.per_page)) } };
  }
  private async audit(principal: SccviPrincipal, accion: string, recurso: string, recursoId?: string, detalle?: object) { await this.auditoria.insert({ accion, recurso, recurso_id: recursoId ?? null, actor_persona_id: principal.personaId ?? null, detalle: detalle ? JSON.stringify(detalle) : null }); }
  private async minor(id: string) { const item = await this.menores.findOneBy({ id }); if (!item) throw new NotFoundException('Menor no encontrado.'); return item; }
  private isStaff(principal: SccviPrincipal) { return ['sccvi.read', 'sccvi.clinical', 'sccvi.admin', 'sso.admin', 'SCCVI_ADMIN', 'SCCVI_DDRISS', 'SCCVI_ESTABLECIMIENTO', 'SCCVI_CONSULTA', 'Administrador'].some(scope => principal.scopes.includes(scope) || principal.roles.includes(scope)); }
  private isGlobalAdmin(principal: SccviPrincipal) { return ['sccvi.admin', 'sso.admin', 'SCCVI_ADMIN', 'Administrador'].some(role => principal.scopes.includes(role) || principal.roles.includes(role)) || (principal.permissions ?? []).includes('CATALOGOS.ADMINISTRAR'); }
  /** Staff lists use the worker base location; global clinical search remains available for travelers. */
  async territoryFor(principal: SccviPrincipal): Promise<{ departamento_codigo?: string; municipio_codigo?: string }> {
    if (this.isGlobalAdmin(principal)) return {};
    if (principal.territory?.departamento_codigo) return principal.roles.includes('SCCVI_ESTABLECIMIENTO') && principal.territory.municipio_codigo ? principal.territory : { departamento_codigo: principal.territory.departamento_codigo };
    // Departamento is a two-character code. An account that has not yet been
    // assigned must remain closed-scope without producing an invalid SQL value.
    if (!principal.personaId) return { departamento_codigo: '00' };
    const person = (await this.sso.resolvePeople([principal.personaId], await this.serviceToken()))[0];
    if (!person?.departamento_codigo) return { departamento_codigo: '00' };
    if (principal.roles.includes('SCCVI_ESTABLECIMIENTO') && person.municipio_codigo) return { departamento_codigo: person.departamento_codigo, municipio_codigo: person.municipio_codigo };
    return { departamento_codigo: person.departamento_codigo };
  }
  private async assertAccess(menorId: string, principal: SccviPrincipal) { if (this.isStaff(principal)) return; if (!principal.personaId) throw new NotFoundException('Menor no encontrado.'); if (!await this.responsables.exist({ where: { menor_id: menorId, persona_id: principal.personaId, estado: true } })) throw new NotFoundException('Menor no encontrado.'); }
  private async patch<T extends ObjectLiteral>(repo: Repository<T>, id: string, version: number, values: object): Promise<T> {
    const result = await repo.createQueryBuilder().update().set({ ...values, version: () => 'version + 1' } as never).where('id = :id AND version = :version', { id, version }).execute();
    if (!result.affected) { if (await repo.exist({ where: { id } as never })) throw new ConflictException('El recurso fue modificado por otra operación.'); throw new NotFoundException('Recurso no encontrado.'); }
    return repo.findOneByOrFail({ id } as never);
  }
  private async validateLocation(input: { departamento_codigo?: string; municipio_codigo?: string; comunidad_ref?: string }) { await this.geo.validateLocation(input.departamento_codigo, input.municipio_codigo, input.comunidad_ref); }
  private serviceToken() { return this.serviceTokens.get(); }
  private dateAtNoon(value: string) { return new Date(`${value}T12:00:00Z`); }
  private ageInDays(birthday: string, date: string) { return Math.floor((this.dateAtNoon(date).getTime() - this.dateAtNoon(birthday).getTime()) / 86_400_000); }
  /** Historic catalog versions must never create new cards or alert schedules. */
  private async currentVaccinationSchema() {
    const today = new Date().toISOString().slice(0, 10);
    const schemas = await this.esquemas.find({ where: { estado: true }, order: { vigencia_desde: 'DESC', id: 'DESC' } });
    const schema = schemas.find(item => item.vigencia_desde <= today && (!item.vigencia_hasta || item.vigencia_hasta >= today));
    if (!schema) throw new NotFoundException('No hay un esquema de vacunación vigente.');
    return schema;
  }
  private async equivalentDoseIds(dose: Pick<EsquemaDosis, 'id' | 'vacuna_id' | 'orden'>) {
    const matches = await this.dosis.find({ where: { vacuna_id: dose.vacuna_id, orden: dose.orden, estado: true }, select: { id: true } });
    const ids = [...new Set(matches.map(item => item.id))];
    return ids.length ? ids : [dose.id];
  }
  private async requirePerson(personaId: string) { const people = await this.sso.resolvePeople([personaId], await this.serviceToken()); if (people.length !== 1 || people[0].persona_id !== personaId) throw new UnprocessableEntityException('La persona indicada no existe o no está activa en SSO.'); return people[0]; }

  /** Projection failures never roll back authoritative clinical writes. */
  private projectLater(menorId: string) { void this.projectionOutbox.enqueue(menorId).catch(() => undefined); }

  async searchPeople(query: PersonaSearchDto) { return this.sso.search(query, await this.serviceToken()); }
  async getPerson(personaId: string, principal: SccviPrincipal) {
    const ownProfile = principal.personaId === personaId;
    let relatedChild = false;
    if (!this.isStaff(principal) && !ownProfile && principal.personaId) {
      const minor = await this.menores.findOneBy({ persona_id: personaId, estado: true });
      relatedChild = Boolean(minor && await this.responsables.exist({ where: { menor_id: minor.id, persona_id: principal.personaId, estado: true } }));
    }
    if (!this.isStaff(principal) && !ownProfile && !relatedChild) throw new NotFoundException('Persona no encontrada.');
    const token = await this.serviceToken(); const people = await this.sso.resolvePeople([personaId], token);
    if (people.length !== 1 || people[0].persona_id !== personaId) throw new NotFoundException('Persona no encontrada en SSO.');
    if (relatedChild) return people[0];
    const contactos = await this.sso.contacts(personaId, token).catch(() => []);
    return { ...people[0], contactos: contactos.filter(contacto => contacto.estado) };
  }
  /** Reverse family view for a responsible adult. Citizen accounts can only read their own links. */
  async dependentsForPerson(personaId: string, principal: SccviPrincipal) {
    if (!this.isStaff(principal) && principal.personaId !== personaId) throw new NotFoundException('Persona no encontrada.');
    const relations = await this.responsables.find({ where: { persona_id: personaId, estado: true }, order: { id: 'ASC' } });
    const ids = relations.map(item => item.menor_id);
    if (!ids.length) return [];
    // This is a direct search result, not a territorial listing: staff can attend
    // a travelling family while the regular minor lists and operational boards stay scoped.
    const minors = await this.menores.find({ where: { id: In(ids), estado: true }, order: { id: 'ASC' } });
    if (!minors.length) return [];
    const [people, applications, measurements] = await Promise.all([
      this.sso.resolvePeople(minors.map(item => item.persona_id), await this.serviceToken()),
      this.registros.find({ where: { menor_id: In(minors.map(item => item.id)), estado: 'VALIDA' }, order: { fecha_aplicacion: 'DESC' } }),
      this.mediciones.find({ where: { menor_id: In(minors.map(item => item.id)) }, order: { fecha: 'DESC' } }),
    ]);
    const personById = new Map(people.map(item => [item.persona_id, item]));
    return minors.map(minor => {
      const child = personById.get(minor.persona_id);
      const relation = relations.find(item => item.menor_id === minor.id);
      const childApplications = applications.filter(item => item.menor_id === minor.id);
      const latestMeasurement = measurements.find(item => item.menor_id === minor.id);
      return {
        menor_id: minor.id, persona_id: minor.persona_id, nombre: child?.ncompleto ?? 'Menor sin nombre disponible', fecha_nacimiento: child?.fecha_nacimiento ?? null,
        relacion: relation?.tipo_relacion ?? 'RESPONSABLE', vacunas_aplicadas: childApplications.length,
        ultima_vacuna_fecha: childApplications[0]?.fecha_aplicacion ?? null,
        ultimo_peso_kg: latestMeasurement?.peso_kg ?? null, fecha_ultimo_peso: latestMeasurement?.fecha ?? null,
      };
    });
  }
  async getMenor(id: string, principal: SccviPrincipal) { const item = await this.minor(id); await this.assertAccess(id, principal); return item; }
  async listMenores(page: MenorQueryDto, principal: SccviPrincipal) {
    const filters = { estado: true, ...(page.persona_id ? { persona_id: page.persona_id } : {}), ...(page.departamento_codigo ? { departamento_codigo: page.departamento_codigo } : {}), ...(page.municipio_codigo ? { municipio_codigo: page.municipio_codigo } : {}) };
    if (this.isStaff(principal)) return this.page(this.menores, page, { ...filters, ...(await this.territoryFor(principal)) });
    if (!principal.personaId) return { items: [], meta: { current_page: page.page, per_page: page.per_page, total: 0, last_page: 1 } };
    const ids = (await this.responsables.find({ where: { persona_id: principal.personaId, estado: true }, select: { menor_id: true } })).map(r => r.menor_id);
    if (!ids.length) return { items: [], meta: { current_page: page.page, per_page: page.per_page, total: 0, last_page: 1 } };
    const builder = this.menores.createQueryBuilder('m').where('m.id IN (:...ids)', { ids }).andWhere('m.estado = 1'); if (page.persona_id) builder.andWhere('m.persona_id = :personaId', { personaId: page.persona_id }); if (page.departamento_codigo) builder.andWhere('m.departamento_codigo = :department', { department: page.departamento_codigo }); if (page.municipio_codigo) builder.andWhere('m.municipio_codigo = :municipality', { municipality: page.municipio_codigo }); const [items, total] = await builder.orderBy('m.id', 'ASC').skip((page.page - 1) * page.per_page).take(page.per_page).getManyAndCount();
    return { items, meta: { current_page: page.page, per_page: page.per_page, total, last_page: Math.max(1, Math.ceil(total / page.per_page)) } };
  }
  async createMenor(input: MenorDto, principal: SccviPrincipal) {
    await this.validateLocation(input);
    await this.requirePerson(input.persona_id);
    try { const item = await this.menores.save(this.menores.create({ ...input, fecha_ingreso: new Date().toISOString().slice(0, 10), pais_codigo: 'GT', estado: true, direccion_ref: input.direccion_ref ?? null, comunidad_ref: input.comunidad_ref ?? null, departamento_codigo: input.departamento_codigo ?? null, municipio_codigo: input.municipio_codigo ?? null, observaciones: input.observaciones ?? null, created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null })); await this.audit(principal, 'CREATE', 'menor', item.id); this.projectLater(item.id); return item; } catch (error) { if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error; throw new ConflictException('Ya existe un menor para esa persona SSO.'); }
  }
  /**
   * The browser never leaves SCCVI. Identities are created through SSO with a
   * deterministic CUI idempotency key, then SCCVI creates only its clinical
   * record and family links.
   */
  async createFamily(input: FamiliaRegistroDto, principal: SccviPrincipal) {
    const responsibleCuis = input.responsables.map(person => person.cui);
    if (responsibleCuis.includes(input.menor.cui)) throw new UnprocessableEntityException('El menor no puede figurar como su propio responsable.');
    if (new Set(responsibleCuis).size !== responsibleCuis.length) throw new UnprocessableEntityException('No se puede registrar dos veces al mismo responsable.');
    await this.validateLocation(input);
    const token = await this.serviceToken();
    const create = async (person: Record<string, unknown>) => {
      try { return await this.sso.createPerson(person, token, `sccvi-family:${String(person.cui)}`); }
      catch (error) {
        const existing = await this.sso.search({ cui: String(person.cui), per_page: 1 }, token);
        if (existing.length === 1) return existing[0];
        throw error;
      }
    };
    const child = await create(input.menor as unknown as Record<string, unknown>);
    const people = await Promise.all(input.responsables.map(person => create(person as unknown as Record<string, unknown>)));
    const minor = await this.createMenor({ persona_id: child.persona_id, direccion_ref: input.direccion_ref, departamento_codigo: input.departamento_codigo, municipio_codigo: input.municipio_codigo, comunidad_ref: input.comunidad_ref, observaciones: input.observaciones }, principal);
    const links = [];
    for (let index = 0; index < input.responsables.length; index += 1) links.push(await this.createResponsable(minor.id, { persona_id: people[index].persona_id, tipo_relacion: input.responsables[index].tipo_relacion, fecha_inicio: new Date().toISOString().slice(0, 10) }, principal));
    await this.audit(principal, 'CREATE_FAMILY', 'menor', minor.id, { responsables: links.map(link => link.id) });
    return { menor: minor, persona: child, responsables: links };
  }
  async updateMenor(id: string, input: UpdateMenorDto, principal: SccviPrincipal) { const current = await this.minor(id); const location = { departamento_codigo: input.departamento_codigo ?? current.departamento_codigo ?? undefined, municipio_codigo: input.municipio_codigo ?? current.municipio_codigo ?? undefined, comunidad_ref: input.comunidad_ref ?? current.comunidad_ref ?? undefined }; await this.validateLocation(location); const { version, ...values } = input; const saved = await this.patch(this.menores, id, version, { ...values, updated_by_persona_id: principal.personaId ?? null }); await this.audit(principal, 'UPDATE', 'menor', id); this.projectLater(id); return saved; }

  async listResponsables(menorId: string, page: PageDto, principal: SccviPrincipal) { await this.minor(menorId); await this.assertAccess(menorId, principal); return this.page(this.responsables, page, { menor_id: menorId, estado: true }); }
  /** Creates or reuses the guardian identity, then adds the clinical link. */
  async registerResponsable(menorId: string, input: FamiliaResponsableDto, principal: SccviPrincipal) {
    await this.minor(menorId);
    const token = await this.serviceToken();
    let person;
    try { person = await this.sso.createPerson(input as unknown as Record<string, unknown>, token, `sccvi-responsable:${input.cui}`); }
    catch (error) {
      const existing = await this.sso.search({ cui: input.cui, per_page: 1 }, token);
      if (existing.length !== 1) throw error;
      person = existing[0];
    }
    return this.createResponsable(menorId, { persona_id: person.persona_id, tipo_relacion: input.tipo_relacion, fecha_inicio: new Date().toISOString().slice(0, 10) }, principal);
  }
  async createResponsable(menorId: string, input: ResponsableDto, principal: SccviPrincipal) { await this.minor(menorId); await this.requirePerson(input.persona_id); try { const item = await this.responsables.save(this.responsables.create({ ...input, menor_id: menorId, fecha_fin: input.fecha_fin ?? null, estado: input.estado ?? true, created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null })); await this.audit(principal, 'CREATE', 'menor_responsable', item.id); this.projectLater(menorId); return item; } catch (error) { if (error instanceof UnprocessableEntityException || error instanceof ServiceUnavailableException) throw error; throw new ConflictException('La relación responsable-menor ya existe.'); } }
  async updateResponsable(menorId: string, id: string, input: UpdateResponsableDto, principal: SccviPrincipal) { if (!await this.responsables.exist({ where: { id, menor_id: menorId } })) throw new NotFoundException('Relación no encontrada.'); const { version, ...values } = input; const saved = await this.patch(this.responsables, id, version, { ...values, updated_by_persona_id: principal.personaId ?? null }); await this.audit(principal, 'UPDATE', 'menor_responsable', id); this.projectLater(menorId); return saved; }
  async deleteResponsable(menorId: string, id: string, version: number, principal: SccviPrincipal) { if (!await this.responsables.exist({ where: { id, menor_id: menorId } })) throw new NotFoundException('Relación no encontrada.'); await this.patch(this.responsables, id, version, { estado: false, fecha_fin: new Date().toISOString().slice(0, 10), updated_by_persona_id: principal.personaId ?? null }); await this.audit(principal, 'DELETE', 'menor_responsable', id); this.projectLater(menorId); return null; }

  async listVacunas(page: PageDto) { return this.page(this.vacunas, page, { estado: true }); }
  async createVacuna(input: VacunaDto, p: SccviPrincipal) { try { const x = await this.vacunas.save(this.vacunas.create({ ...input, fabricante: input.fabricante ?? null, estado: input.estado ?? true, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); await this.audit(p, 'CREATE', 'vacuna', x.id); return x; } catch { throw new ConflictException('Código de vacuna duplicado.'); } }
  async updateVacuna(id: string, input: UpdateVacunaDto, p: SccviPrincipal) { const { version, ...values } = input; const saved = await this.patch(this.vacunas, id, version, { ...values, updated_by_persona_id: p.personaId ?? null }); await this.audit(p, 'UPDATE', 'vacuna', id); return saved; }
  async listEsquemas(page: PageDto) { return this.page(this.esquemas, page, { estado: true }); }
  async createEsquema(input: EsquemaDto, p: SccviPrincipal) { try { const x = await this.esquemas.save(this.esquemas.create({ ...input, vigencia_hasta: input.vigencia_hasta ?? null, estado: input.estado ?? true, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); await this.audit(p, 'CREATE', 'esquema', x.id); return x; } catch { throw new ConflictException('Código de esquema duplicado.'); } }
  async updateEsquema(id: string, input: UpdateEsquemaDto, p: SccviPrincipal) { const { version, ...values } = input; const saved = await this.patch(this.esquemas, id, version, { ...values, updated_by_persona_id: p.personaId ?? null }); await this.audit(p, 'UPDATE', 'esquema', id); return saved; }
  async addDosis(esquemaId: string, input: DosisDto, p: SccviPrincipal) { if (!await this.esquemas.exist({ where: { id: esquemaId, estado: true } })) throw new NotFoundException('Esquema no encontrado.'); if (!await this.vacunas.exist({ where: { id: input.vacuna_id, estado: true } })) throw new UnprocessableEntityException('Vacuna no disponible.'); if (input.edad_maxima_dias !== undefined && input.edad_maxima_dias < input.edad_minima_dias) throw new UnprocessableEntityException('La edad máxima no puede ser menor a la edad mínima.'); let saved: EsquemaDosis; try { saved = await this.dosis.save(this.dosis.create({ ...input, esquema_id: esquemaId, edad_maxima_dias: input.edad_maxima_dias ?? null, intervalo_minimo_dias: input.intervalo_minimo_dias ?? null, estado: true, recordatorio_anticipacion_dias: 14, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); } catch { throw new ConflictException('Dosis duplicada en el esquema.'); } await this.audit(p, 'CREATE', 'esquema_dosis', saved.id); return saved; }

  async vaccination(menorId: string, page: PageDto, principal: SccviPrincipal) { await this.minor(menorId); await this.assertAccess(menorId, principal); return this.page(this.registros, page, { menor_id: menorId }); }
  async vaccinationCard(menorId: string, principal: SccviPrincipal) {
    const minor = await this.minor(menorId); await this.assertAccess(menorId, principal);
    const schema = await this.currentVaccinationSchema();
    if (!schema) throw new NotFoundException('No hay un esquema de vacunación activo.');
    const [doses, records, people] = await Promise.all([
      this.dosis.find({ where: { esquema_id: schema.id, estado: true }, order: { orden: 'ASC', id: 'ASC' } }),
      this.registros.find({ where: { menor_id: menorId, estado: 'VALIDA' } }),
      this.sso.resolvePeople([minor.persona_id], await this.serviceToken()),
    ]);
    const birthday = people[0]?.fecha_nacimiento;
    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new BadGatewayException('SSO no devolvió una fecha de nacimiento válida para el menor.');
    const vaccineIds = [...new Set(doses.map(dose => dose.vacuna_id))]; const vaccines = vaccineIds.length ? await this.vacunas.findBy({ id: In(vaccineIds) }) : [];
    const currentById = new Map(doses.map(dose => [dose.id, dose])); const missingDefinitionIds = [...new Set(records.map(record => record.esquema_dosis_id).filter(id => !currentById.has(id)))]; const historicDefinitions = missingDefinitionIds.length ? await this.dosis.findBy({ id: In(missingDefinitionIds) }) : []; const definitionById = new Map([...doses, ...historicDefinitions].map(dose => [dose.id, dose]));
    const equivalentKey = (dose: Pick<EsquemaDosis, 'vacuna_id' | 'orden'>) => `${dose.vacuna_id}:${dose.orden}`; const byVaccine = new Map(vaccines.map(vaccine => [vaccine.id, vaccine])); const byEquivalentDose = new Map<string, RegistroVacunacion[]>(); for (const record of records) { const definition = definitionById.get(record.esquema_dosis_id); if (!definition) continue; const key = equivalentKey(definition); byEquivalentDose.set(key, [...(byEquivalentDose.get(key) ?? []), record].sort((a, b) => b.fecha_aplicacion.localeCompare(a.fecha_aplicacion))); }
    const today = new Date().toISOString().slice(0, 10);
    return { menor_id: minor.id, persona_id: minor.persona_id, esquema: { esquema_id: schema.id, codigo: schema.codigo, nombre: schema.nombre, vigencia_desde: schema.vigencia_desde }, dosis: doses.map(dose => { const scheduled = new Date(`${birthday}T12:00:00Z`); scheduled.setUTCDate(scheduled.getUTCDate() + dose.edad_minima_dias); const vaccine = byVaccine.get(dose.vacuna_id); const applications = byEquivalentDose.get(equivalentKey(dose)) ?? []; const latest = applications[0]; const due = new Date(`${latest?.fecha_aplicacion ?? scheduled.toISOString().slice(0, 10)}T12:00:00Z`); if (latest && dose.intervalo_repeticion_dias) due.setUTCDate(due.getUTCDate() + dose.intervalo_repeticion_dias); const recurring = Boolean(dose.intervalo_repeticion_dias); return { esquema_dosis_id: dose.id, vacuna_id: dose.vacuna_id, vacuna_codigo: vaccine?.codigo ?? null, vacuna_nombre: vaccine?.nombre ?? null, orden: dose.orden, edad_minima_dias: dose.edad_minima_dias, edad_maxima_dias: dose.edad_maxima_dias, intervalo_repeticion_dias: dose.intervalo_repeticion_dias, fecha_programada: due.toISOString().slice(0, 10), fecha_aplicacion: latest?.fecha_aplicacion ?? null, aplicaciones: applications.map(record => ({ secuencia: record.secuencia, fecha_aplicacion: record.fecha_aplicacion })), estado: latest && !recurring ? 'APLICADA' : latest && due.toISOString().slice(0, 10) > today ? 'VIGENTE' : 'PENDIENTE' }; }) };
  }
  async applyDose(menorId: string, input: AplicacionDto, p: SccviPrincipal) { await this.minor(menorId); if (!await this.dosis.exist({ where: { id: input.esquema_dosis_id, estado: true } })) throw new UnprocessableEntityException('La dosis no está disponible.'); if (input.jornada_id && !await this.jornadas.exist({ where: { id: input.jornada_id } })) throw new UnprocessableEntityException('La jornada no existe.'); const secuencia = input.secuencia ?? 1; if (secuencia > 1) { const dose = await this.dosis.findOneBy({ id: input.esquema_dosis_id, estado: true }); if (!dose?.intervalo_repeticion_dias) throw new UnprocessableEntityException('Esta dosis no admite aplicaciones recurrentes.'); } try { const x = await this.registros.save(this.registros.create({ ...input, secuencia, menor_id: menorId, jornada_id: input.jornada_id ?? null, profesional_persona_id: p.personaId ?? null, estado: 'VALIDA', observaciones: input.observaciones ?? null, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); await this.audit(p, 'APPLY', 'registro_vacunacion', x.id); this.projectLater(menorId); return x; } catch { throw new ConflictException('Ya existe una aplicación válida con esa secuencia para el menor.'); } }
  /** Applies clinical eligibility in the authoritative write path, never in the browser. */
  async applyValidatedDose(menorId: string, input: AplicacionDto, principal: SccviPrincipal) {
    const minor = await this.minor(menorId);
    if (input.fecha_aplicacion > new Date().toISOString().slice(0, 10)) throw new UnprocessableEntityException('La fecha de aplicación no puede estar en el futuro.');
    const dose = await this.dosis.findOneBy({ id: input.esquema_dosis_id, estado: true });
    if (!dose) throw new UnprocessableEntityException('La dosis no esta disponible.');
    if (input.jornada_id && !await this.jornadas.exist({ where: { id: input.jornada_id } })) throw new UnprocessableEntityException('La jornada no existe.');
    const people = await this.sso.resolvePeople([minor.persona_id], await this.serviceToken());
    const birthday = people[0]?.fecha_nacimiento;
    if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new BadGatewayException('SSO no devolvio una fecha de nacimiento valida para el menor.');
    const age = this.ageInDays(birthday, input.fecha_aplicacion);
    if (age < dose.edad_minima_dias || (dose.edad_maxima_dias !== null && age > dose.edad_maxima_dias)) throw new UnprocessableEntityException('La fecha de aplicacion esta fuera de la ventana de edad definida por el esquema.');
    const sequence = input.secuencia ?? 1;
    const equivalentIds = await this.equivalentDoseIds(dose);
    if (await this.registros.exist({ where: { menor_id: menorId, esquema_dosis_id: In(equivalentIds), secuencia: sequence, estado: 'VALIDA' } })) throw new ConflictException('La dosis equivalente ya fue registrada para el menor.');
    if (sequence > 1) {
      if (!dose.intervalo_repeticion_dias) throw new UnprocessableEntityException('Esta dosis no admite aplicaciones recurrentes.');
      const previous = await this.registros.findOne({ where: { menor_id: menorId, esquema_dosis_id: In(equivalentIds), secuencia: sequence - 1, estado: 'VALIDA' } });
      if (!previous) throw new UnprocessableEntityException('Registra primero la aplicacion anterior de la serie.');
      if (this.ageInDays(previous.fecha_aplicacion, input.fecha_aplicacion) < dose.intervalo_repeticion_dias) throw new UnprocessableEntityException('No se cumple el intervalo minimo de la serie recurrente.');
    } else if (dose.intervalo_minimo_dias) {
      const previousDose = await this.dosis.findOne({ where: { esquema_id: dose.esquema_id, vacuna_id: dose.vacuna_id, orden: dose.orden - 1, estado: true } });
      if (previousDose) {
        const previous = await this.registros.findOne({ where: { menor_id: menorId, esquema_dosis_id: In(await this.equivalentDoseIds(previousDose)), estado: 'VALIDA' }, order: { fecha_aplicacion: 'DESC' } });
        if (!previous) throw new UnprocessableEntityException('Registra primero la dosis anterior del esquema.');
        if (this.ageInDays(previous.fecha_aplicacion, input.fecha_aplicacion) < dose.intervalo_minimo_dias) throw new UnprocessableEntityException('No se cumple el intervalo minimo con la dosis anterior.');
      }
    }
    const actorTerritory = await this.territoryFor(principal);
    const location = {
      departamento_codigo: input.departamento_codigo ?? actorTerritory.departamento_codigo ?? minor.departamento_codigo ?? undefined,
      municipio_codigo: input.municipio_codigo ?? actorTerritory.municipio_codigo ?? minor.municipio_codigo ?? undefined,
      comunidad_ref: input.comunidad_ref ?? minor.comunidad_ref ?? undefined,
    };
    if (!location.departamento_codigo || !location.municipio_codigo) throw new UnprocessableEntityException('Indica el lugar donde se aplicó la vacuna.');
    await this.validateLocation(location);
    try {
      const saved = await this.registros.save(this.registros.create({ ...input, ...location, secuencia: sequence, menor_id: menorId, jornada_id: input.jornada_id ?? null, profesional_persona_id: principal.personaId ?? null, estado: 'VALIDA', observaciones: input.observaciones ?? null, created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null }));
      const alert = await this.alertas.findOneBy({ menor_id: menorId, esquema_dosis_id: dose.id });
      if (alert) { alert.estado = 'RESUELTA'; alert.updated_by_persona_id = principal.personaId ?? null; await this.alertas.save(alert); }
      await this.audit(principal, 'APPLY', 'registro_vacunacion', saved.id); this.projectLater(menorId); return saved;
    } catch { throw new ConflictException('Ya existe una aplicacion valida con esa secuencia para el menor.'); }
  }

  private publicTokenParts(value: string) { const [selector, verifier, ...rest] = value.split('.'); return !rest.length && selector && verifier && /^[A-Za-z0-9_-]{16,72}$/.test(selector) && /^[A-Za-z0-9_-]{32,128}$/.test(verifier) ? { selector, verifier } : null; }
  private async validPublicCard(token: string, menorId?: string) {
    const parts = this.publicTokenParts(token);
    const card = await this.carnesPublicos.findOneBy(parts ? { token: parts.selector, estado: true, ...(menorId ? { menor_id: menorId } : {}) } : { token, estado: true, ...(menorId ? { menor_id: menorId } : {}) });
    if (!card || (card.expira_at && card.expira_at.getTime() < Date.now())) return null;
    if (!card.token_hash) return parts ? null : card; // Controlled compatibility for links created before hardening.
    return parts && await argon2.verify(card.token_hash, parts.verifier) ? card : null;
  }

  async createPublicCard(menorId: string, principal: SccviPrincipal) {
    await this.minor(menorId); await this.assertAccess(menorId, principal);
    for (const active of await this.carnesPublicos.find({ where: { menor_id: menorId, estado: true } })) { active.estado = false; active.updated_by_persona_id = principal.personaId ?? null; await this.carnesPublicos.save(active); }
    const selector = randomBytes(12).toString('base64url'); const verifier = randomBytes(32).toString('base64url'); const pin = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const hashOptions = { type: argon2.argon2id, salt: randomBytes(16), memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 } as const;
    const token_hash = await argon2.hash(verifier, hashOptions); const pin_hash = await argon2.hash(pin, { ...hashOptions, salt: randomBytes(16) });
    const ttlDays = Math.min(3650, Math.max(1, Number(this.config.get('PUBLIC_CARD_TTL_DAYS', 365)) || 365)); const expira_at = new Date(Date.now() + ttlDays * 86_400_000);
    const card = await this.carnesPublicos.save(this.carnesPublicos.create({ menor_id: menorId, token: selector, token_hash, pin_hash, intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso_at: null, estado: true, expira_at, created_by_persona_id: principal.personaId ?? null, updated_by_persona_id: principal.personaId ?? null }));
    await this.audit(principal, 'CREATE', 'carne_publico', card.id);
    return { token: `${selector}.${verifier}`, pin, revocable: true, expira_at: expira_at.toISOString() };
  }

  async publicCardStatus(token: string) {
    const card = await this.validPublicCard(token);
    if (!card?.pin_hash) throw new NotFoundException('El enlace del carné no está disponible.');
    return { requiere_pin: true, expira_at: card.expira_at?.toISOString() ?? null };
  }

  async publicCard(token: string, pin: string) {
    const card = await this.validPublicCard(token);
    if (!card?.pin_hash) throw new NotFoundException('El enlace del carné no está disponible.');
    const now = new Date();
    if (card.bloqueado_hasta && card.bloqueado_hasta.getTime() > now.getTime()) throw new HttpException('Demasiados intentos. Intenta nuevamente más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    if (card.bloqueado_hasta) { card.bloqueado_hasta = null; card.intentos_fallidos = 0; }
    if (!await argon2.verify(card.pin_hash, pin)) {
      card.intentos_fallidos += 1;
      if (card.intentos_fallidos >= 5) { card.bloqueado_hasta = new Date(now.getTime() + 15 * 60_000); card.intentos_fallidos = 0; }
      await this.carnesPublicos.save(card);
      throw new UnauthorizedException('PIN incorrecto.');
    }
    card.intentos_fallidos = 0; card.bloqueado_hasta = null; card.ultimo_acceso_at = now; await this.carnesPublicos.save(card);
    const raw = await this.vaccinationCard(card.menor_id, { userId: '0', roles: ['SCCVI_ADMIN'], scopes: ['sccvi.admin'], permissions: [], payload: { sub: '0' } });
    const minor = await this.minor(card.menor_id); const [person] = await this.sso.resolvePeople([minor.persona_id], await this.serviceToken()); const latest = await this.mediciones.findOne({ where: { menor_id: card.menor_id }, order: { fecha: 'DESC' } });
    await this.auditoria.insert({ accion: 'READ_PUBLIC', recurso: 'carne_publico', recurso_id: card.id, actor_persona_id: null, detalle: null });
    return { menor: { nombre: person?.ncompleto ?? 'Menor' }, esquema: raw.esquema, emitido_en: now.toISOString(), ultimo_control: latest ? { fecha: latest.fecha, peso_kg: latest.peso_kg, talla_cm: latest.talla_cm, imc: latest.imc } : null, dosis: raw.dosis.map(dose => ({ vacuna_codigo: dose.vacuna_codigo, vacuna_nombre: dose.vacuna_nombre, orden: dose.orden, fecha_programada: dose.fecha_programada, fecha_aplicacion: dose.fecha_aplicacion, estado: dose.estado })) };
  }

  async revokePublicCard(menorId: string, token: string, principal: SccviPrincipal) {
    await this.minor(menorId); await this.assertAccess(menorId, principal);
    const card = await this.validPublicCard(token, menorId);
    if (!card) throw new NotFoundException('El enlace del carné no está disponible.');
    card.estado = false; card.updated_by_persona_id = principal.personaId ?? null; await this.carnesPublicos.save(card);
    await this.audit(principal, 'REVOKE', 'carne_publico', card.id); return null;
  }

  async measurements(menorId: string, page: PageDto, principal: SccviPrincipal) { await this.minor(menorId); await this.assertAccess(menorId, principal); return this.page(this.mediciones, page, { menor_id: menorId }); }
  async addMeasurement(menorId: string, input: MedicionDto, p: SccviPrincipal) { const minor = await this.minor(menorId); const today = new Date().toISOString().slice(0, 10); if (input.fecha > today) throw new UnprocessableEntityException('La fecha de medición no puede estar en el futuro.'); const person = await this.requirePerson(minor.persona_id); if (person.fecha_nacimiento && input.fecha < person.fecha_nacimiento) throw new UnprocessableEntityException('La medición no puede ser anterior al nacimiento.'); const imc = (input.peso_kg / ((input.talla_cm / 100) ** 2)).toFixed(2); try { const saved = await this.mediciones.save(this.mediciones.create({ menor_id: menorId, fecha: input.fecha, peso_kg: input.peso_kg.toFixed(2), talla_cm: input.talla_cm.toFixed(2), imc, observaciones: input.observaciones ?? null, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); await this.audit(p, 'CREATE', 'medicion_antropometrica', saved.id); this.projectLater(menorId); return saved; } catch (error) { if (error instanceof UnprocessableEntityException || error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error; throw new ConflictException('Ya existe una medición para ese menor y fecha.'); } }

  async listJornadas(page: PageDto) { return this.page(this.jornadas, page); }
  async createJornada(input: JornadaDto, p: SccviPrincipal) { if (input.fecha_fin < input.fecha_inicio) throw new UnprocessableEntityException('La fecha final no puede ser anterior a la inicial.'); await this.validateLocation(input); const x = await this.jornadas.save(this.jornadas.create({ nombre: input.nombre, fecha_inicio: input.fecha_inicio, fecha_fin: input.fecha_fin, direccion_ref: input.direccion_ref ?? null, departamento_codigo: input.departamento_codigo ?? null, municipio_codigo: input.municipio_codigo ?? null, comunidad_ref: input.comunidad_ref ?? null, estado: input.estado ?? 'PLANIFICADA', created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); for (const vacunaId of input.vacuna_ids ?? []) { if (!await this.vacunas.exist({ where: { id: vacunaId, estado: true } })) throw new UnprocessableEntityException('Una vacuna de la jornada no existe o está inactiva.'); await this.jornadaVacunas.save(this.jornadaVacunas.create({ jornada_id: x.id, vacuna_id: vacunaId, existencias: null, estado: true, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null })); } await this.audit(p, 'CREATE', 'jornada', x.id); return x; }
  async updateJornada(id: string, input: UpdateJornadaDto, p: SccviPrincipal) { const previous = await this.jornadas.findOneBy({ id }); if (!previous) throw new NotFoundException('Jornada no encontrada.'); const start = input.fecha_inicio ?? previous.fecha_inicio; const end = input.fecha_fin ?? previous.fecha_fin; if (end < start) throw new UnprocessableEntityException('La fecha final no puede ser anterior a la inicial.'); await this.validateLocation({ departamento_codigo: input.departamento_codigo ?? previous.departamento_codigo ?? undefined, municipio_codigo: input.municipio_codigo ?? previous.municipio_codigo ?? undefined, comunidad_ref: input.comunidad_ref ?? previous.comunidad_ref ?? undefined }); const { version, ...values } = input; const saved = await this.patch(this.jornadas, id, version, { ...values, updated_by_persona_id: p.personaId ?? null }); await this.audit(p, 'UPDATE', 'jornada', id); return saved; }
  async notifyJornada(id: string, input: { titulo?: string; contenido?: string }, p: SccviPrincipal) {
    const jornada = await this.jornadas.findOneBy({ id });
    if (!jornada) throw new NotFoundException('Jornada no encontrada.');
    if (!jornada.departamento_codigo && !jornada.municipio_codigo && !jornada.comunidad_ref) throw new UnprocessableEntityException('La jornada debe indicar departamento, municipio o comunidad antes de notificar.');
    const minors = await this.menores.find({ where: { estado: true, ...(jornada.departamento_codigo ? { departamento_codigo: jornada.departamento_codigo } : {}), ...(jornada.municipio_codigo ? { municipio_codigo: jornada.municipio_codigo } : {}), ...(jornada.comunidad_ref ? { comunidad_ref: jornada.comunidad_ref } : {}) } });
    const minorIds = minors.map(minor => minor.id);
    const token = await this.serviceToken();
    const residents = typeof this.sso.residents === 'function'
      ? await this.sso.residents({ departamento_codigo: jornada.departamento_codigo, municipio_codigo: jornada.municipio_codigo, comunidad_ref: jornada.comunidad_ref }, token)
      : await (async () => {
        const relations = minorIds.length ? await this.responsables.find({ where: { estado: true, menor_id: In(minorIds) } }) : [];
        const candidateIds = [...new Set(relations.map(relation => relation.persona_id))];
        const people = candidateIds.length ? await this.sso.resolvePeople(candidateIds, token) : [];
        return people.filter(person => (!jornada.departamento_codigo || person.departamento_codigo === jornada.departamento_codigo) && (!jornada.municipio_codigo || person.municipio_codigo === jornada.municipio_codigo) && (!jornada.comunidad_ref || person.comunidad_ref === jornada.comunidad_ref));
      })();
    const recipients = [...new Set(residents.map(person => person.persona_id))];
    const scope = jornada.comunidad_ref ? 'su comunidad' : jornada.municipio_codigo ? 'su municipio' : 'su departamento';
    for (const personaId of recipients) await this.outbox.enqueue(personaId, null, 'SCCVI_JORNADA', { jornada_id: jornada.id, jornada_nombre: jornada.nombre, fecha_inicio: jornada.fecha_inicio, fecha_fin: jornada.fecha_fin, alcance: scope }, `jornada:${jornada.id}:persona:${personaId}`, { titulo: input.titulo ?? 'Jornada de vacunación', contenido: input.contenido ?? `Hay una jornada de vacunación programada para ${scope}.` });
    await this.audit(p, 'NOTIFY', 'jornada', jornada.id, { menores: minorIds.length, destinatarios: recipients.length });
    return { menores: minorIds.length, destinatarios: recipients.length, encolados: recipients.length };
  }

  /** Only guardians of children with an actionable pending dose receive a campaign notice. */
  async notifyEligibleJornada(id: string, input: { titulo?: string; contenido?: string }, p: SccviPrincipal) {
    const jornada = await this.jornadas.findOneBy({ id });
    if (!jornada) throw new NotFoundException('Jornada no encontrada.');
    if (!jornada.departamento_codigo && !jornada.municipio_codigo && !jornada.comunidad_ref) throw new UnprocessableEntityException('La jornada debe indicar departamento, municipio o comunidad antes de notificar.');
    const campaignVaccines = await this.jornadaVacunas.find({ where: { jornada_id: id, estado: true } });
    if (!campaignVaccines.length) throw new UnprocessableEntityException('Selecciona al menos una vacuna para notificar esta jornada.');
    const doseRows = await this.dosis.find({ where: { estado: true, vacuna_id: In(campaignVaccines.map(item => item.vacuna_id)) } });
    const doseIds = new Set(doseRows.map(item => item.id));
    const minors = await this.menores.find({ where: { estado: true, ...(jornada.departamento_codigo ? { departamento_codigo: jornada.departamento_codigo } : {}), ...(jornada.municipio_codigo ? { municipio_codigo: jornada.municipio_codigo } : {}), ...(jornada.comunidad_ref ? { comunidad_ref: jornada.comunidad_ref } : {}) } });
    const minorIds = minors.map(minor => minor.id);
    const actionable = minorIds.length ? await this.alertas.find({ where: { menor_id: In(minorIds), estado: 'PENDIENTE' } }) : [];
    const eligibleIds = new Set(actionable.filter(alert => alert.tipo !== 'PENDIENTE' && doseIds.has(alert.esquema_dosis_id)).map(alert => alert.menor_id));
    const links = eligibleIds.size ? await this.responsables.find({ where: { menor_id: In([...eligibleIds]), estado: true } }) : [];
    const scope = jornada.comunidad_ref ? 'su comunidad' : jornada.municipio_codigo ? 'su municipio' : 'su departamento';
    let queued = 0;
    for (const link of links) {
      await this.outbox.enqueue(link.persona_id, link.menor_id, 'SCCVI_JORNADA', { jornada_id: jornada.id, jornada_nombre: jornada.nombre, fecha_inicio: jornada.fecha_inicio, fecha_fin: jornada.fecha_fin, alcance: scope }, `jornada:${jornada.id}:menor:${link.menor_id}:persona:${link.persona_id}`, { titulo: input.titulo ?? 'Jornada de vacunación', contenido: input.contenido ?? `Hay una jornada de vacunación para una dosis pendiente de su menor en ${scope}.` });
      queued += 1;
    }
    await this.audit(p, 'NOTIFY', 'jornada', jornada.id, { menores: eligibleIds.size, destinatarios: queued, vacunas: campaignVaccines.map(item => item.vacuna_id) });
    return { menores: eligibleIds.size, destinatarios: queued, encolados: queued };
  }

  async notifyTomorrowJornadas() {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const campaigns = await this.jornadas.find({ where: { fecha_inicio: tomorrow, estado: 'PLANIFICADA' } });
    const principal: SccviPrincipal = { userId: '0', scopes: ['sccvi.admin'], roles: ['SYSTEM'], permissions: ['CATALOGOS.ADMINISTRAR'], payload: { sub: '0' } };
    await this.recalculateAlerts(principal);
    const results = [];
    for (const campaign of campaigns) results.push(await this.notifyEligibleJornada(campaign.id, {}, principal));
    return { jornadas: campaigns.length, resultados: results };
  }

  /** Daily operational job: closes elapsed campaigns and only sends campaign notices before they start. */
  async processDailyReminders() {
    const today = new Date().toISOString().slice(0, 10);
    const closing = await this.jornadas.find({ where: { estado: In(['PLANIFICADA', 'ACTIVA']) } });
    const expired = closing.filter(item => item.fecha_fin < today);
    for (const campaign of expired) await this.jornadas.update(campaign.id, { estado: 'CERRADA' });
    const campaigns = await this.notifyTomorrowJornadas();
    return { cerradas: expired.length, ...campaigns };
  }

  private async alertPage(page: PageDto, where: object) {
    const result = await this.page(this.alertas, page, where);
    if (!result.items.length) return result;
    const doses = await this.dosis.findBy({ id: In(result.items.map(item => item.esquema_dosis_id)) });
    const doseById = new Map(doses.map(item => [item.id, item]));
    const vaccines = await this.vacunas.findBy({ id: In(doses.map(item => item.vacuna_id)) });
    const vaccineById = new Map(vaccines.map(item => [item.id, item]));
    return { ...result, items: result.items.map(item => {
      const vaccine = vaccineById.get(doseById.get(item.esquema_dosis_id)?.vacuna_id ?? '');
      return { ...item, vacuna_codigo: vaccine?.codigo ?? null, vacuna_nombre: vaccine?.nombre ?? null };
    }) };
  }
  async alerts(menorId: string, page: PageDto, principal: SccviPrincipal) { await this.minor(menorId); await this.assertAccess(menorId, principal); return this.alertPage(page, { menor_id: menorId }); }
  async recalculateAlerts(p: SccviPrincipal) {
    const schema = await this.currentVaccinationSchema();
    const [doses, minors] = await Promise.all([this.dosis.find({ where: { estado: true, esquema_id: schema.id }, order: { id: 'ASC' } }), this.menores.find({ where: { estado: true }, order: { id: 'ASC' } })]);
    const persons = await this.sso.resolvePeople(minors.map(minor => minor.persona_id), await this.serviceToken());
    const birthdays = new Map(persons.filter(person => /^\d{4}-\d{2}-\d{2}$/.test(person.fecha_nacimiento ?? '')).map(person => [person.persona_id, person.fecha_nacimiento!]));
    if (birthdays.size !== minors.length) throw new BadGatewayException('SSO no devolvió fecha de nacimiento para todos los menores activos.');
    const today = new Date(); const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()); let count = 0;
    for (const menor of minors) for (const dose of doses) {
      const latest = await this.registros.findOne({ where: { menor_id: menor.id, esquema_dosis_id: In(await this.equivalentDoseIds(dose)), estado: 'VALIDA' }, order: { fecha_aplicacion: 'DESC', secuencia: 'DESC' } });
      const existing = await this.alertas.findOneBy({ menor_id: menor.id, esquema_dosis_id: dose.id });
      if (latest && !dose.intervalo_repeticion_dias) { if (existing && existing.estado !== 'RESUELTA') { existing.estado = 'RESUELTA'; existing.notificado_at = null; existing.updated_by_persona_id = p.personaId ?? null; await this.alertas.save(existing); } continue; }
      const due = new Date(`${latest?.fecha_aplicacion ?? birthdays.get(menor.persona_id)}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + (latest ? dose.intervalo_repeticion_dias! : dose.edad_minima_dias)); const when = due.toISOString().slice(0, 10); const diff = Math.ceil((due.getTime() - todayUtc) / 86400000); const type = diff < 0 ? 'ATRASADA' : diff <= dose.recordatorio_anticipacion_dias ? 'PROXIMA' : 'PENDIENTE';
      if (existing) { existing.fecha_programada = when; existing.tipo = type; existing.estado = 'PENDIENTE'; existing.notificado_at = null; existing.updated_by_persona_id = p.personaId ?? null; await this.alertas.save(existing); } else await this.alertas.save(this.alertas.create({ menor_id: menor.id, esquema_dosis_id: dose.id, fecha_programada: when, tipo: type, estado: 'PENDIENTE', notificado_at: null, created_by_persona_id: p.personaId ?? null, updated_by_persona_id: p.personaId ?? null }));
      const reminderWindow = diff === 7 || diff === 1;
      if (reminderWindow || type === 'ATRASADA') {
        const vaccine = await this.vacunas.findOneBy({ id: dose.vacuna_id });
        for (const responsible of await this.responsables.find({ where: { menor_id: menor.id, estado: true } })) {
          await this.outbox.enqueue(responsible.persona_id, menor.id, 'SCCVI_RECORDATORIO', {
            menor_id: menor.id, esquema_dosis_id: dose.id, vacuna_codigo: vaccine?.codigo ?? '', vacuna_nombre: vaccine?.nombre ?? '', fecha_programada: when, tipo: type, dias_para_dosis: String(diff),
          }, `alerta:${menor.id}:${dose.id}:${responsible.persona_id}:${when}`);
        }
      }
      count++;
    }
    await this.audit(p, 'RECALCULATE', 'alertas_vacunacion', undefined, { recalculadas: count }); for (const minor of minors) this.projectLater(minor.id); return { recalculadas: count };
  }
  async coverage(principal: SccviPrincipal) {
    const territory = await this.territoryFor(principal);
    const minors = await this.menores.find({ where: { estado: true, ...territory }, order: { id: 'ASC' } });
    if (!minors.length) return { menores: 0, aplicaciones: 0, dosis_esperadas: 0, dosis_cumplidas: 0, cobertura: 0 };
    const schema = await this.currentVaccinationSchema(); const today = new Date().toISOString().slice(0, 10);
    const [currentDoses, people, applications] = await Promise.all([
      this.dosis.find({ where: { esquema_id: schema.id, estado: true }, order: { id: 'ASC' } }),
      this.sso.resolvePeople(minors.map(minor => minor.persona_id), await this.serviceToken()),
      this.registros.find({ where: { menor_id: In(minors.map(minor => minor.id)), estado: 'VALIDA' } }),
    ]);
    const birthdays = new Map(people.filter(person => /^\d{4}-\d{2}-\d{2}$/.test(person.fecha_nacimiento ?? '')).map(person => [person.persona_id, person.fecha_nacimiento!]));
    if (birthdays.size !== minors.length) throw new BadGatewayException('SSO no devolvió fecha de nacimiento para todos los menores del reporte.');
    const currentById = new Map(currentDoses.map(dose => [dose.id, dose])); const missingIds = [...new Set(applications.map(item => item.esquema_dosis_id).filter(id => !currentById.has(id)))]; const historicDoses = missingIds.length ? await this.dosis.findBy({ id: In(missingIds) }) : []; const definitionById = new Map([...currentDoses, ...historicDoses].map(dose => [dose.id, dose])); const key = (minorId: string, dose: Pick<EsquemaDosis, 'vacuna_id' | 'orden'>) => `${minorId}:${dose.vacuna_id}:${dose.orden}`; const appliedByKey = new Map<string, number>();
    for (const application of applications) { const definition = definitionById.get(application.esquema_dosis_id); if (!definition) continue; const applicationKey = key(application.menor_id, definition); appliedByKey.set(applicationKey, (appliedByKey.get(applicationKey) ?? 0) + 1); }
    let expected = 0; let completed = 0;
    for (const minor of minors) { const age = this.ageInDays(birthdays.get(minor.persona_id)!, today); for (const dose of currentDoses) { if (age < dose.edad_minima_dias) continue; const boundedAge = dose.edad_maxima_dias === null ? age : Math.min(age, dose.edad_maxima_dias); const required = dose.intervalo_repeticion_dias ? Math.max(1, 1 + Math.floor((boundedAge - dose.edad_minima_dias) / dose.intervalo_repeticion_dias)) : 1; expected += required; completed += Math.min(required, appliedByKey.get(key(minor.id, dose)) ?? 0); } }
    return { menores: minors.length, aplicaciones: applications.length, dosis_esperadas: expected, dosis_cumplidas: completed, cobertura: expected ? Number((completed / expected).toFixed(4)) : 0 };
  }
  async applicationAnalytics(principal: SccviPrincipal) {
    const territory = await this.territoryFor(principal);
    const points = await this.registros.createQueryBuilder('r').select('r.departamento_codigo', 'departamento_codigo').addSelect('r.municipio_codigo', 'municipio_codigo').addSelect('COUNT(*)', 'aplicaciones').where('r.estado = :estado', { estado: 'VALIDA' }).andWhere(territory.departamento_codigo ? 'r.departamento_codigo = :departamento' : '1=1', { departamento: territory.departamento_codigo }).andWhere(territory.municipio_codigo ? 'r.municipio_codigo = :municipio' : '1=1', { municipio: territory.municipio_codigo }).groupBy('r.departamento_codigo').addGroupBy('r.municipio_codigo').getRawMany<{ departamento_codigo: string; municipio_codigo: string; aplicaciones: string }>();
    const vaccines = await this.registros.createQueryBuilder('r').innerJoin(EsquemaDosis, 'd', 'd.id = r.esquema_dosis_id').innerJoin(Vacuna, 'v', 'v.id = d.vacuna_id').select('v.codigo', 'codigo').addSelect('v.nombre', 'nombre').addSelect('COUNT(*)', 'aplicaciones').where('r.estado = :estado', { estado: 'VALIDA' }).andWhere(territory.departamento_codigo ? 'r.departamento_codigo = :departamento' : '1=1', { departamento: territory.departamento_codigo }).andWhere(territory.municipio_codigo ? 'r.municipio_codigo = :municipio' : '1=1', { municipio: territory.municipio_codigo }).groupBy('v.codigo').addGroupBy('v.nombre').orderBy('COUNT(*)', 'DESC').take(10).getRawMany<{ codigo: string; nombre: string; aplicaciones: string }>();
    return { puntos: points.map(point => ({ ...point, aplicaciones: Number(point.aplicaciones) })), vacunas: vaccines.map(vaccine => ({ ...vaccine, aplicaciones: Number(vaccine.aplicaciones) })) };
  }
  async pendingReport(page: PageDto, principal: SccviPrincipal) {
    const territory = await this.territoryFor(principal);
    if (!territory.departamento_codigo && !territory.municipio_codigo) return this.alertPage(page, { estado: 'PENDIENTE' });
    const minorIds = (await this.menores.find({ where: { estado: true, ...territory }, select: { id: true } })).map(minor => minor.id);
    if (!minorIds.length) return { items: [], meta: { current_page: page.page, per_page: page.per_page, total: 0, last_page: 1 } };
    return this.alertPage(page, { estado: 'PENDIENTE', menor_id: In(minorIds) });
  }
}
