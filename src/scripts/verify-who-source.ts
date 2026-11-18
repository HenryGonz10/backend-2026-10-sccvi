import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Dataset = { parameters: Array<[string, string, number, number, number, number]> };
type Manifest = { dataset: string; expected_parameters: number; json_sha256: string; sources: Record<string, string> };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function run() {
  const root = join(process.cwd(), 'src', 'data', 'who');
  const [rawDataset, rawManifest] = await Promise.all([readFile(join(root, 'who-cgs-2006-lms.json')), readFile(join(root, 'manifest.json'))]);
  const manifest = JSON.parse(rawManifest.toString('utf8')) as Manifest;
  const dataset = JSON.parse(rawDataset.toString('utf8')) as Dataset;
  if (sha256(rawDataset) !== manifest.json_sha256) throw new Error('El checksum del JSON OMS no coincide con el manifiesto archivado.');
  if (dataset.parameters.length !== manifest.expected_parameters) throw new Error(`El JSON OMS contiene ${dataset.parameters.length}; se esperaban ${manifest.expected_parameters}.`);
  const unique = new Set(dataset.parameters.map(([indicator, sex, x]) => `${indicator}|${sex}|${x}`));
  if (unique.size !== manifest.expected_parameters) throw new Error('El JSON OMS contiene parámetros LMS duplicados.');
  for (const [name, expected] of Object.entries(manifest.sources)) {
    const actual = sha256(await readFile(join(root, 'source', name)));
    if (actual !== expected) throw new Error(`El checksum de ${name} no coincide con el manifiesto OMS.`);
  }
  console.log(JSON.stringify({ valid: true, data: { dataset: manifest.dataset, parameters: dataset.parameters.length, unique_parameters: unique.size, json_sha256: manifest.json_sha256, sources: Object.keys(manifest.sources).length }, msg: 'Fuentes OMS archivadas y JSON LMS verificados.' }));
}
void run();
