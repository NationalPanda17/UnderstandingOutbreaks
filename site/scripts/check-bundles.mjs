// Asserts that tool runtimes and simulation solvers are absent from the main bundle and the embed bundle.
// Works on the module list recorded at build time (dist/chunk-modules.json), following static imports only.
import { readFileSync } from 'node:fs';
const chunks = JSON.parse(readFileSync(new URL('../dist/chunk-modules.json', import.meta.url)));
const byFile = new Map(chunks.map((c) => [c.file, c]));
const closure = (entry) => { const seen = new Set(); const stack = [entry.file]; while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); for (const i of byFile.get(f)?.imports ?? []) stack.push(i); } return [...seen].flatMap((f) => byFile.get(f)?.modules ?? []); };
const FORBIDDEN = [
  [/@duckdb\/duckdb-wasm|apache-arrow/, 'DuckDB-WASM'], [/pyodide/, 'Pyodide'], [/node_modules\/webr/, 'webR'], [/@observablehq\/plot/, 'Observable Plot (chart builder)'],
  [/src\/sim\/engine\//, 'simulation engine (solvers)'], [/src\/sim\/worker/, 'simulation worker'], [/node_modules\/katex/, 'KaTeX'], [/src\/workbench\//, 'workbench tools'], [/maplibre-gl/, 'MapLibre (must be lazy)'],
];
let bad = 0;
for (const [name, test] of [['main', (c) => /index\.html$/.test(c.facade ?? '') || c.name === 'main'], ['embed', (c) => /embed\.html$/.test(c.facade ?? '') || c.name === 'embed']]) {
  const entry = chunks.find((c) => c.isEntry && test(c));
  if (!entry) { console.error(`entry chunk "${name}" not found`); bad++; continue; }
  const mods = closure(entry);
  for (const [re, label] of FORBIDDEN) { const hit = mods.find((m) => re.test(m)); if (hit) { console.error(`${name} bundle statically includes ${label}: ${hit}`); bad++; } }
  console.log(`${name}: ${mods.length} modules in the static bundle; no tool runtime or solver present`);
}
// the embed bundle must not contain site chrome either
const embed = chunks.find((c) => c.isEntry && (/embed\.html$/.test(c.facade ?? '') || c.name === 'embed'));
if (embed && closure(embed).some((m) => /components\/Layout|pages\//.test(m) && !/Layout/.test(m))) { console.error('embed bundle includes site pages'); bad++; }
if (bad) process.exit(1);
