// Fails when a literal translation key used in the source is missing from the default locale,
// or when any launch locale is missing a key that the default locale has.
import { readFileSync } from 'node:fs';
import { literal } from './extract-keys.mjs';
const site = JSON.parse(readFileSync(new URL('../../config/site.json', import.meta.url)));
const load = (l) => JSON.parse(readFileSync(new URL(`../src/i18n/locales/${l}.json`, import.meta.url)));
const base = load(site.defaultLocale);
let bad = 0;
for (const k of literal) if (!(k in base)) { console.error(`missing in ${site.defaultLocale}: ${k}`); bad++; }
for (const l of site.locales.map((x) => x.code).filter((c) => c !== site.defaultLocale)) {
  let msgs; try { msgs = load(l); } catch { console.error(`locale file missing: ${l}`); bad++; continue; }
  const miss = Object.keys(base).filter((k) => !(k in msgs));
  if (miss.length) { console.error(`${l}: ${miss.length} missing keys, e.g. ${miss.slice(0, 8).join(', ')}`); bad += miss.length; }
  const extra = Object.keys(msgs).filter((k) => !(k in base));
  if (extra.length) console.warn(`${l}: ${extra.length} keys not in ${site.defaultLocale}, e.g. ${extra.slice(0, 5).join(', ')}`);
}
if (bad) { console.error(`i18n check failed: ${bad} problem(s)`); process.exit(1); }
console.log('i18n check passed:', Object.keys(base).length, 'keys');
