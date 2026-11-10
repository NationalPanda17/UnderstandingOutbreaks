// Dev helper: merges src/i18n/parts/<locale>/*.json into the single drop-in file src/i18n/locales/<locale>.json.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('../src/i18n/', import.meta.url).pathname;
for (const loc of readdirSync(join(root, 'parts'))) {
  const dir = join(root, 'parts', loc);
  const out = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const part = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(part)) { if (k in out) throw new Error(`duplicate key ${k} in ${loc}/${f}`); out[k] = v; }
  }
  writeFileSync(join(root, 'locales', `${loc}.json`), JSON.stringify(out, null, 1) + '\n');
  console.log(loc, Object.keys(out).length, 'keys');
}
