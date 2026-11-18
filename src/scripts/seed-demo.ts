import dataSource from '../data-source';
import { EsquemaDosis, EsquemaVacunacion, MedicionAntropometrica, Menor, MenorResponsable, RegistroVacunacion, Vacuna } from '../shared/persistence/entities';

type Vaccine = readonly [code: string, name: string];
type Dose = readonly [code: string, order: number, minDays: number, maxDays: number | null, intervalDays: number | null, recurrenceDays?: number | null];
type Department = { codigo: string; nombre: string };
type Municipality = { codigo: string; nombre: string; departamento_codigo: string };

/**
 * Minors (and matching guardians) expected per Geo department.
 * Must stay aligned with `MspasVerapacesDemoSeeder` / `SSO_SEED_CHILDREN_PER_DEPARTMENT`.
 */
const CHILDREN_PER_DEPARTMENT = Math.max(50, Number(process.env.SCCVI_SEED_CHILDREN_PER_DEPARTMENT || process.env.SSO_SEED_CHILDREN_PER_DEPARTMENT || 50));

const RELATION_TYPES = ['MADRE', 'PADRE', 'ENCARGADO', 'ABUELA', 'TIO'] as const;

// Demonstration-only catalogue. It is intentionally not represented as an
// approved MSPAS schedule: no official versioned source is configured here.
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
  const base = process.env.SSO_BASE_URL;
  const email = process.env.SSO_SERVICE_USERNAME;
  const password = process.env.SSO_SERVICE_PASSWORD;
  // Match SsoServiceTokenService: a configured technical account has priority
  // over a static fallback token, which may have expired between local runs.
  if (!base || !email || !password) {
    return process.env.SSO_SERVICE_TOKEN
      ? (technicalToken = process.env.SSO_SERVICE_TOKEN)
      : null;
  }
  const origin = new URL(base).origin;
  // SSO exposes the compatibility credential endpoint under the versioned API.
  // Keep this seed on the documented route so the local DEMO integration is
  // exercised through the same issuer used by SCCVI at runtime.
  const response = await fetch(`${origin}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', System: process.env.SSO_SYSTEM_TAG ?? 'sccvi' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json() as { valid?: boolean; data?: { token?: string } };
  return response.ok && body.valid && body.data?.token ? technicalToken = body.data.token : null;
}

/**
 * Loads every active SSO person card for a department into a CUI→persona_id map.
 * One paginated sweep replaces thousands of single-CUI lookups and avoids flaky
 * per-request failures under seed load.
 */
async function loadDepartmentPeople(departmentCode: string, token: string): Promise<Map<string, string>> {
  const base = process.env.SSO_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('SSO_BASE_URL no está configurado.');

  const byCui = new Map<string, string>();
  let page = 1;
  let lastPage = 1;

  do {
    const params = new URLSearchParams({
      departamento_codigo: departmentCode,
      per_page: '100',
      page: String(page),
    });
    const response = await fetch(`${base}/personas?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        System: process.env.SSO_SYSTEM_TAG ?? 'sccvi',
        Accept: 'application/json',
      },
    });
    const body = await response.json() as {
      valid?: boolean;
      data?: Array<{ persona_id: string; cui?: string }>;
      meta?: { last_page?: number };
      msg?: string;
    };
    if (!response.ok || !body.valid || !Array.isArray(body.data)) {
      throw new Error(`No fue posible listar personas SSO del departamento ${departmentCode}: ${body.msg ?? response.status}`);
    }
    for (const person of body.data) {
      if (person.cui) byCui.set(person.cui, String(person.persona_id));
    }
    lastPage = Math.max(1, Number(body.meta?.last_page ?? 1));
    page += 1;
  } while (page <= lastPage);

  return byCui;
}

async function loadDepartments(): Promise<Array<{ department: Department; municipality: Municipality }>> {
  const base = process.env.GEO_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('GEO_BASE_URL no está configurado.');

  const departmentsResponse = await fetch(`${base}/departamentos`, { headers: { Accept: 'application/json' } });
  const departmentsBody = await departmentsResponse.json() as { valid?: boolean; data?: Department[] };
  if (!departmentsResponse.ok || !departmentsBody.valid || !departmentsBody.data?.length) {
    throw new Error('Geo no devolvió el catálogo de departamentos.');
  }

  const territories: Array<{ department: Department; municipality: Municipality }> = [];
  for (const department of departmentsBody.data) {
    const municipalitiesResponse = await fetch(`${base}/departamentos/${encodeURIComponent(department.codigo)}/municipios`, {
      headers: { Accept: 'application/json' },
    });
    const municipalitiesBody = await municipalitiesResponse.json() as { valid?: boolean; data?: Municipality[] };
    const municipalities = municipalitiesBody.data ?? [];
    const municipality = municipalities.find((item) => item.codigo.endsWith('01')) ?? municipalities[0];
    if (!municipality) throw new Error(`El departamento ${department.codigo} no tiene municipios en Geo.`);
    territories.push({ department, municipality });
  }
  return territories;
}

/** Same 13-digit convention as `MspasVerapacesDemoSeeder` national families. */
function demoCui(departmentCode: string, role: 1 | 2, sequence: number): string {
  return `90${departmentCode}${role}${String(sequence).padStart(8, '0')}`;
}

function dateDaysAgo(days: number): string {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function run() {
  const db = await dataSource.initialize();
  try {
    const vaccines = db.getRepository(Vacuna);
    const schemas = db.getRepository(EsquemaVacunacion);
    const doses = db.getRepository(EsquemaDosis);

    for (const [codigo, nombre] of catalog2026) {
      const current = await vaccines.findOneBy({ codigo });
      await vaccines.save(current
        ? Object.assign(current, { nombre, fabricante: null, estado: true })
        : vaccines.create({ codigo, nombre, fabricante: null, estado: true, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
    }

    let schema = await schemas.findOneBy({ codigo: 'PAI-GT-REGULAR-2021' });
    schema = await schemas.save(schema
      ? Object.assign(schema, { nombre: 'Histórico DEMO — referencia 2021 no clínica', vigencia_desde: '2021-01-01', vigencia_hasta: '2025-12-31', estado: false })
      : schemas.create({ codigo: 'PAI-GT-REGULAR-2021', nombre: 'Histórico DEMO — referencia 2021 no clínica', vigencia_desde: '2021-01-01', vigencia_hasta: '2025-12-31', estado: false, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));

    const historical = await schemas.findOneBy({ codigo: 'PAI-GT-REGULAR-2021' });
    if (historical && !historical.vigencia_hasta) {
      await schemas.save(Object.assign(historical, { vigencia_hasta: '2025-12-31', estado: true }));
    }

    let schema2026 = await schemas.findOneBy({ codigo: 'PAI-GT-DEMO-2026' });
    schema2026 = await schemas.save(schema2026
      ? Object.assign(schema2026, { nombre: 'DEMO — calendario de vacunación no clínico', vigencia_desde: '2026-01-01', vigencia_hasta: null, estado: true })
      : schemas.create({ codigo: 'PAI-GT-DEMO-2026', nombre: 'DEMO — calendario de vacunación no clínico', vigencia_desde: '2026-01-01', vigencia_hasta: null, estado: true, created_by_persona_id: null, updated_by_persona_id: null, version: 1 }));
    schema = schema2026;

    for (const [code, order, minDays, maxDays, intervalDays, recurrenceDays = null] of pediatricDoses2026) {
      const vaccine = await vaccines.findOneByOrFail({ codigo: code });
      const current = await doses.findOneBy({ esquema_id: schema.id, vacuna_id: vaccine.id, orden: order });
      const value = {
        esquema_id: schema.id,
        vacuna_id: vaccine.id,
        orden: order,
        edad_minima_dias: minDays,
        edad_maxima_dias: maxDays,
        intervalo_minimo_dias: intervalDays,
        intervalo_repeticion_dias: recurrenceDays,
        recordatorio_anticipacion_dias: 14,
        estado: true,
        created_by_persona_id: null,
        updated_by_persona_id: null,
      };
      await doses.save(current ? Object.assign(current, value) : doses.create({ ...value, version: 1 }));
    }

    const minors = db.getRepository(Menor);
    const responsible = db.getRepository(MenorResponsable);
    const measurements = db.getRepository(MedicionAntropometrica);
    const records = db.getRepository(RegistroVacunacion);

    const token = await ssoToken();
    if (!token) throw new Error('No fue posible obtener la credencial técnica de SSO para la semilla SCCVI.');

    const territories = await loadDepartments();
    const bcg = await doses.findOneByOrFail({ esquema_id: schema.id, vacuna_id: (await vaccines.findOneByOrFail({ codigo: 'BCG' })).id, orden: 1 });
    const hepatitis = await doses.findOneByOrFail({ esquema_id: schema.id, vacuna_id: (await vaccines.findOneByOrFail({ codigo: 'HEPB' })).id, orden: 1 });

    // Personas viven en SSO. Este seed sólo resuelve CUIs nacionales ya sembrados
    // por MspasVerapacesDemoSeeder y materializa el expediente clínico en SCCVI.
    let createdMinors = 0;
    let createdLinks = 0;
    const perDepartment: Array<{ departamento: string; menores: number }> = [];

    for (const { department, municipality } of territories) {
      let departmentMinors = 0;
      const peopleByCui = await loadDepartmentPeople(department.codigo, token);

      for (let sequence = 1; sequence <= CHILDREN_PER_DEPARTMENT; sequence += 1) {
        const index = sequence - 1;
        const childCui = demoCui(department.codigo, 1, sequence);
        const guardianCui = demoCui(department.codigo, 2, sequence);
        const childPersonaId = peopleByCui.get(childCui);
        const guardianPersonaId = peopleByCui.get(guardianCui);
        if (!childPersonaId || !guardianPersonaId) {
          throw new Error(
            `Faltan personas SSO para ${department.codigo} (#${sequence}: child=${childCui}, guardian=${guardianCui}). `
            + 'Ejecute primero `php artisan db:seed --class=MspasVerapacesDemoSeeder` en backend-2026-02-sso.',
          );
        }

        const childAgeDays = 30 + ((index * 37) % (5 * 365));
        const weight = Number((4.5 + (childAgeDays / 365) * 2.1 + (index % 5) * 0.15).toFixed(2));
        const height = Number((52 + (childAgeDays / 365) * 8.5 + (index % 4) * 0.4).toFixed(1));
        const relation = RELATION_TYPES[index % RELATION_TYPES.length];

        let minor = await minors.findOneBy({ persona_id: childPersonaId });
        minor = await minors.save(minor
          ? Object.assign(minor, {
            departamento_codigo: department.codigo,
            municipio_codigo: municipality.codigo,
            estado: true,
            observaciones: `Registro ficticio DEMO — ${department.nombre}.`,
          })
          : minors.create({
            persona_id: childPersonaId,
            fecha_ingreso: dateDaysAgo(14),
            direccion_ref: null,
            pais_codigo: 'GT',
            departamento_codigo: department.codigo,
            municipio_codigo: municipality.codigo,
            comunidad_ref: null,
            estado: true,
            observaciones: `Registro ficticio DEMO — ${department.nombre}.`,
            created_by_persona_id: null,
            updated_by_persona_id: null,
            version: 1,
          }));
        departmentMinors += 1;
        createdMinors += 1;

        const link = await responsible.findOneBy({ menor_id: minor.id, persona_id: guardianPersonaId });
        await responsible.save(link
          ? Object.assign(link, { estado: true, fecha_fin: null, tipo_relacion: relation })
          : responsible.create({
            menor_id: minor.id,
            persona_id: guardianPersonaId,
            tipo_relacion: relation,
            fecha_inicio: dateDaysAgo(365),
            fecha_fin: null,
            estado: true,
            created_by_persona_id: null,
            updated_by_persona_id: null,
            version: 1,
          }));
        createdLinks += 1;

        const date = dateDaysAgo(7);
        const imc = (weight / ((height / 100) ** 2)).toFixed(2);
        const measurement = await measurements.findOneBy({ menor_id: minor.id, fecha: date });
        await measurements.save(measurement
          ? Object.assign(measurement, { peso_kg: weight.toFixed(2), talla_cm: height.toFixed(2), imc, observaciones: 'Medición ficticia de verificación.' })
          : measurements.create({
            menor_id: minor.id,
            fecha: date,
            peso_kg: weight.toFixed(2),
            talla_cm: height.toFixed(2),
            imc,
            observaciones: 'Medición ficticia de verificación.',
            created_by_persona_id: null,
            updated_by_persona_id: null,
            version: 1,
          }));

        for (const [dose, applied] of [[bcg, dateDaysAgo(60)], [hepatitis, dateDaysAgo(59)]] as const) {
          const record = await records.findOneBy({ menor_id: minor.id, esquema_dosis_id: dose.id, secuencia: 1 });
          await records.save(record
            ? Object.assign(record, { estado: 'VALIDA', fecha_aplicacion: applied })
            : records.create({
              menor_id: minor.id,
              esquema_dosis_id: dose.id,
              secuencia: 1,
              fecha_aplicacion: applied,
              jornada_id: null,
              profesional_persona_id: null,
              estado: 'VALIDA',
              observaciones: 'Aplicación ficticia de verificación.',
              created_by_persona_id: null,
              updated_by_persona_id: null,
              version: 1,
            }));
        }
      }

      perDepartment.push({ departamento: department.codigo, menores: departmentMinors });
      console.log(JSON.stringify({
        valid: true,
        data: { departamento: department.codigo, nombre: department.nombre, municipio: municipality.codigo, menores: departmentMinors },
        msg: `Semilla DEMO aplicada para ${department.nombre}.`,
      }));
    }

    console.log(JSON.stringify({
      valid: true,
      data: {
        vacunas: catalog2026.length,
        dosis: pediatricDoses2026.length,
        esquema: schema.codigo,
        departamentos: territories.length,
        menores_por_departamento: CHILDREN_PER_DEPARTMENT,
        menores: createdMinors,
        responsables: createdLinks,
        detalle: perDepartment,
      },
      msg: 'Seed SCCVI de demostración aplicado (mín. 50 menores por departamento, cada uno con responsable).',
    }));
  } finally {
    await db.destroy();
  }
}

void run();
