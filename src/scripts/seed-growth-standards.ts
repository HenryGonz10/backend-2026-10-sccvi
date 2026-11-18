import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import dataSource from '../data-source';
import { EstandarCrecimiento, ParametroCrecimiento } from '../entities';

type Dataset = { standard: { code: string; name: string; version: string; source_url: string; age_min_days: number; age_max_days: number }; parameters: Array<[string, string, number, number, number, number]> };

async function dataset(): Promise<{ value: Dataset; sha256: string }> {
  const candidates = [join(process.cwd(), 'src', 'data', 'who', 'who-cgs-2006-lms.json'), join(process.cwd(), 'dist', 'data', 'who', 'who-cgs-2006-lms.json')];
  for (const path of candidates) try { const bytes = await readFile(path); return { value: JSON.parse(bytes.toString('utf8')) as Dataset, sha256: createHash('sha256').update(bytes).digest('hex') }; } catch { /* try deployed candidate */ }
  throw new Error('No se encontró el conjunto LMS OMS versionado.');
}

async function run() {
  const db = await dataSource.initialize();
  try {
    const input = await dataset(); const standards = db.getRepository(EstandarCrecimiento); const parameters = db.getRepository(ParametroCrecimiento);
    let standard = await standards.findOneBy({ codigo: input.value.standard.code });
    const standardValue = { codigo: input.value.standard.code, nombre: input.value.standard.name, version_fuente: input.value.standard.version, fuente_url: input.value.standard.source_url, sha256_datos: input.sha256, edad_minima_dias: input.value.standard.age_min_days, edad_maxima_dias: input.value.standard.age_max_days, estado: true, created_by_persona_id: null, updated_by_persona_id: null };
    standard = await standards.save(standard ? Object.assign(standard, standardValue) : standards.create({ ...standardValue, version: 1 }));
    const values = input.value.parameters.map(([indicador, sexo_curva, x, l, m, s]) => ({ estandar_id: standard.id, indicador, sexo_curva, x: x.toFixed(2), l: l.toFixed(8), m: m.toFixed(8), s: s.toFixed(8) }));
    // SQL Server accepts at most 2,100 parameters per statement. Each LMS row
    // contributes seven values, so keep the idempotent upsert safely below it.
    const batchSize = 250;
    for (let start = 0; start < values.length; start += batchSize) await parameters.upsert(values.slice(start, start + batchSize), ['estandar_id', 'indicador', 'sexo_curva', 'x']);
    console.log(JSON.stringify({ valid: true, data: { estandar: standard.codigo, parametros: input.value.parameters.length, sha256: input.sha256 }, msg: 'Estándar OMS de crecimiento cargado de forma idempotente.' }));
  } finally { await db.destroy(); }
}
void run();
