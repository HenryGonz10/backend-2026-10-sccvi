import dataSource from '../data-source';
import { EsquemaDosis, EsquemaVacunacion, MedicionAntropometrica, Menor, MenorResponsable, RegistroVacunacion, Vacuna } from '../entities';

type Vaccine = readonly [code: string, name: string];
type Dose = readonly [code: string, order: number, minDays: number, maxDays: number | null, intervalDays: number | null, recurrenceDays?: number | null];

// Official MSPAS 2026 version. Alternatives coexist because the source defines
// a first/second option according to the biologic available at the service.
const catalog2026: Vaccine[] = [
  ['BCG', 'BCG'], ['HEPB', 'Hepatitis B pediatrica'], ['PENTA', 'Pentavalente (DPT-HepB-Hib)'], ['HEXA', 'Hexavalente (DPT-HepB-Hib-IPV)'], ['IPV', 'Polio inactivada (IPV)'], ['OPV', 'Polio oral (OPV)'], ['ROTA', 'Rotavirus'], ['PCV', 'Neumococo conjugada'], ['SRP', 'Sarampion, rubeola y parotiditis'], ['DPT', 'Difteria, tetanos y tos ferina'], ['INFLUENZA', 'Influenza estacional pediatrica'], ['VPH', 'Virus del papiloma humano'], ['TD', 'Tetanos y difteria'], ['TDAP', 'Tetanos, difteria y tos ferina acelular'], ['VARICELA', 'Varicela'],
];
const pediatricDoses2026: Dose[] = [
  ['HEPB', 1, 0, 1, null], ['BCG', 1, 0, 364, null],
  ['PENTA', 1, 60, null, null], ['PENTA', 2, 120, null, 28], ['PENTA', 3, 180, null, 28], ['PENTA', 4, 540, null, 180],
  ['IPV', 1, 60, null, null], ['OPV', 1, 120, null, 28], ['OPV', 2, 180, null, 28], ['IPV', 2, 540, null, 180], ['OPV', 3, 1460, null, 365],
  ['HEXA', 1, 60, null, null], ['HEXA', 2, 120, null, 28], ['HEXA', 3, 180, null, 28], ['HEXA', 4, 540, null, 180],
  ['ROTA', 1, 60, 119, null], ['ROTA', 2, 120, 239, 28], ['PCV', 1, 60, null, null], ['PCV', 2, 120, null, 28], ['PCV', 3, 365, null, 120],
  ['INFLUENZA', 1, 180, null, null], ['INFLUENZA', 2, 210, null, 28], ['INFLUENZA', 3, 540, null, 150, 365],
  ['SRP', 1, 365, null, null], ['VARICELA', 1, 450, null, null], ['SRP', 2, 540, null, 28], ['DPT', 1, 1460, null, 365], ['VARICELA', 2, 1460, null, 365], ['TD', 1, 3650, null, null], ['VPH', 1, 3285, 6209, null],
];

let technicalToken: string | undefined;
async function ssoToken(): Promise<string | null> {
  if (technicalToken) return technicalToken;
  if (process.env.SSO_SERVICE_TOKEN) return technicalToken = process.env.SSO_SERVICE_TOKEN;
  const base = process.env.SSO_BASE_URL; const email = process.env.SSO_SERVICE_USERNAME; const password = process.env.SSO_SERVICE_PASSWORD;
  if (!base || !email || !password) return null;
  const origin = new URL(base).origin;
  const response = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', System: process.env.SSO_SYSTEM_TAG ?? 'sccvi' }, body: JSON.stringify({ email, password }) });
  const body = await response.json() as { valid?: boolean; data?: { token?: string } };
  return response.ok && body.valid && body.data?.token ? technicalToken = body.data.token : null;
}
async function resolvePersona(cui: string, token: string): Promise<string | null> {
  const base = process.env.SSO_BASE_URL;
  if (!base || !token) return null;
  const response = await fetch(`${base.replace(/\/$/, '')}/personas?cui=${encodeURIComponent(cui)}&per_page=1`, { headers: { Authorization: `Bearer ${token}`, System: process.env.SSO_SYSTEM_TAG ?? 'sccvi' } });
  const body = await response.json() as { valid?: boolean; data?: Array<{ persona_id: string }> };
  return response.ok && body.valid && body.data?.[0]?.persona_id ? body.data[0].persona_id : null;
}

async function run() {
  const db = await dataSource.initialize();
  try {
    // Relative UTC dates keep the local demo clinically coherent on every rerun.
    const dateDaysAgo = (days: number) => { const value = new Date(); value.setUTCHours(12, 0, 0, 0); value.setUTCDate(value.getUTCDate() - days); return value.toISOString().slice(0, 10); };
    const vaccines = db.getRepository(Vacuna); const schemas = db.getRepository(EsquemaVacunacion); const doses = db.getRepository(EsquemaDosis);
    for (const [codigo, nombre] of catalog2026) {
      const current = await vaccines.findOneBy({ codigo });
      await vaccines.save(current ? Object.assign(current, { nombre, fabricante: null, estado: true }) : vaccines.create({ codigo, nombre, fabricante: null, estado: true, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
    }
    let schema = await schemas.findOneBy({ codigo: 'PAI-GT-REGULAR-2021' });
    schema = await schemas.save(schema ? Object.assign(schema, { nombre: 'PAI Guatemala regular pediátrico (referencia 2021)', vigencia_desde: '2021-01-01', vigencia_hasta: null, estado: true }) : schemas.create({ codigo: 'PAI-GT-REGULAR-2021', nombre: 'PAI Guatemala regular pediátrico (referencia 2021)', vigencia_desde: '2021-01-01', vigencia_hasta: null, estado: true, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
    const historical = await schemas.findOneBy({ codigo: 'PAI-GT-REGULAR-2021' });
    if (historical && !historical.vigencia_hasta) await schemas.save(Object.assign(historical, { vigencia_hasta: '2025-12-31', estado: true }));
    let schema2026 = await schemas.findOneBy({ codigo: 'PAI-GT-2026' });
    schema2026 = await schemas.save(schema2026 ? Object.assign(schema2026, { nombre: 'PAI Guatemala 2026 - esquema nacional', vigencia_desde: '2026-01-01', vigencia_hasta: null, estado: true }) : schemas.create({ codigo: 'PAI-GT-2026', nombre: 'PAI Guatemala 2026 - esquema nacional', vigencia_desde: '2026-01-01', vigencia_hasta: null, estado: true, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
    schema = schema2026;
    for (const [code, order, minDays, maxDays, intervalDays, recurrenceDays = null] of pediatricDoses2026) {
      const vaccine = await vaccines.findOneByOrFail({ codigo: code }); const current = await doses.findOneBy({ esquema_id: schema.id, vacuna_id: vaccine.id, orden: order });
      const value = { esquema_id: schema.id, vacuna_id: vaccine.id, orden: order, edad_minima_dias: minDays, edad_maxima_dias: maxDays, intervalo_minimo_dias: intervalDays, intervalo_repeticion_dias: recurrenceDays, recordatorio_anticipacion_dias: 14, estado: true, created_by_persona_id: null, updated_by_persona_id: null };
      await doses.save(current ? Object.assign(current, value) : doses.create({ ...value, version: 1 }));
    }

    const minors = db.getRepository(Menor); const responsible = db.getRepository(MenorResponsable); const measurements = db.getRepository(MedicionAntropometrica); const records = db.getRepository(RegistroVacunacion);
    const token = await ssoToken();
    if (!token) throw new Error('No fue posible obtener la credencial técnica de SSO para la semilla SCCVI.');
    const people = await Promise.all(['9000000000001', '9000000000002', '9000000000003', '9000000000004', '9000000000005', '9000000000011', '9000000000012', '9000000000013'].map(cui => resolvePersona(cui, token)));
    if (people.some(id => !id)) throw new Error('Ejecute primero MspasVerapacesDemoSeeder en SSO con su credencial de servicio configurada.');
    const [child1, child2, child3, child4, child5, guardian1, guardian2, guardian3] = people as string[];
    const rows: Array<[string, string, string, string, number, number]> = [[child1, guardian1, '16', '1601', 8.1, 70], [child2, guardian1, '16', '1601', 10.3, 82], [child3, guardian2, '15', '1501', 6.8, 64], [child4, guardian2, '15', '1501', 12.4, 90], [child5, guardian3, '16', '1601', 4.9, 56]];
    const bcg = await doses.findOneByOrFail({ esquema_id: schema.id, vacuna_id: (await vaccines.findOneByOrFail({ codigo: 'BCG' })).id, orden: 1 });
    const hepatitis = await doses.findOneByOrFail({ esquema_id: schema.id, vacuna_id: (await vaccines.findOneByOrFail({ codigo: 'HEPB' })).id, orden: 1 });
    for (const [personaId, guardianId, department, municipality, weight, height] of rows) {
      let minor = await minors.findOneBy({ persona_id: personaId });
      minor = await minors.save(minor ? Object.assign(minor, { departamento_codigo: department, municipio_codigo: municipality, estado: true }) : minors.create({ persona_id: personaId, fecha_ingreso: dateDaysAgo(14), direccion_ref: null, pais_codigo: 'GT', departamento_codigo: department, municipio_codigo: municipality, comunidad_ref: null, estado: true, observaciones: 'Registro ficticio para verificación local.', created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
      const link = await responsible.findOneBy({ menor_id: minor.id, persona_id: guardianId }); await responsible.save(link ? Object.assign(link, { estado: true, fecha_fin: null }) : responsible.create({ menor_id: minor.id, persona_id: guardianId, tipo_relacion: 'ENCARGADO', fecha_inicio: dateDaysAgo(365), fecha_fin: null, estado: true, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
      const date = dateDaysAgo(7); const imc = (weight / ((height / 100) ** 2)).toFixed(2); const measurement = await measurements.findOneBy({ menor_id: minor.id, fecha: date }); await measurements.save(measurement ? Object.assign(measurement, { peso_kg: weight.toFixed(2), talla_cm: height.toFixed(2), imc, observaciones: 'Medición ficticia de verificación.' }) : measurements.create({ menor_id: minor.id, fecha: date, peso_kg: weight.toFixed(2), talla_cm: height.toFixed(2), imc, observaciones: 'Medición ficticia de verificación.', created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
      for (const [dose, applied] of [[bcg, dateDaysAgo(60)], [hepatitis, dateDaysAgo(59)]] as const) { const record = await records.findOneBy({ menor_id: minor.id, esquema_dosis_id: dose.id, secuencia: 1 }); await records.save(record ? Object.assign(record, { estado: 'VALIDA', fecha_aplicacion: applied }) : records.create({ menor_id: minor.id, esquema_dosis_id: dose.id, secuencia: 1, fecha_aplicacion: applied, jornada_id: null, profesional_persona_id: null, estado: 'VALIDA', observaciones: 'Aplicación ficticia de verificación.', created_by_persona_id: null, updated_by_persona_id: null, version: 1 })); }
    }
    console.log(JSON.stringify({ valid: true, data: { vacunas: catalog2026.length, dosis: pediatricDoses2026.length, esquema: schema.codigo, menores: rows.length }, msg: 'Seed SCCVI de demostración aplicado.' }));
  } finally { await db.destroy(); }
}
void run();
