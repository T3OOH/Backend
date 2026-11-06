/**
 * Atualiza src/data/municipios-ibge.json com a lista oficial de municípios do IBGE
 * (API de Localidades: https://servicodados.ibge.gov.br/api/docs/localidades).
 *
 * A API usa uma cópia local para não depender do IBGE no ar. Municípios novos são raros
 * (o último foi criado em 2024): rode isto quando o IBGE anunciar mudança.
 *   node scripts/atualizar-municipios.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';
const DESTINO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/municipios-ibge.json');

const res = await fetch(URL_IBGE, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
const lista = await res.json();
// [código IBGE, nome oficial, UF], em ordem alfabética
const compacto = lista
    .map((m) => [m['municipio-id'], m['municipio-nome'], m['UF-sigla']])
    .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR') || a[2].localeCompare(b[2]));
if (compacto.length < 5500) throw new Error(`Lista incompleta: ${compacto.length} municípios`);
await writeFile(DESTINO, `${JSON.stringify(compacto)}\n`);
console.log(`${compacto.length} municípios gravados em ${path.relative(process.cwd(), DESTINO)}`);
