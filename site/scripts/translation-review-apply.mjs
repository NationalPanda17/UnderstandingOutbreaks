// Applies a completed translation review sheet (see translations-report.mjs --sheets).
//   node site/scripts/translation-review-apply.mjs <locale> <file.csv> "<who reviewed, e.g. native speaker, public health>"
// A row counts as reviewed when its "OK" column is y/yes or its "Corrected text" column is filled in. A correction
// replaces the draft in the part file that holds the key. Placeholders such as {n} must survive: a correction that
// drops or adds one is refused and reported. Rows left empty stay "awaiting review". Nothing is published by this
// script; run the i18n merge and checks afterwards.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
// UO_I18N_ROOT points the script at another copy of the site folder (used by its test).
const root = process.env.UO_I18N_ROOT ?? new URL('..', import.meta.url).pathname;
const [locale, file, by] = process.argv.slice(2);
if (!locale || !file || !by) { console.error('usage: translation-review-apply.mjs <locale> <file.csv> "<who reviewed>"'); process.exit(2); }

export function parseCsv(text) {
  const rows = []; let row = [], cur = '', quoted = false;
  text = text.replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}

const dir = `${root}src/i18n/parts/${locale}/`;
const parts = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ f, doc: JSON.parse(readFileSync(dir + f, 'utf8')) }));
const en = JSON.parse(readFileSync(`${root}src/i18n/locales/en.json`, 'utf8'));
const statusPath = root + 'src/i18n/review-status.json';
let status = {}; try { status = JSON.parse(readFileSync(statusPath, 'utf8')); } catch { /* first review */ }
status[locale] ??= {};
const holes = (s) => (String(s).match(/\{[a-zA-Z_]+/g) ?? []).sort().join(' ');
const today = new Date().toISOString().slice(0, 10);
let ok = 0, fixed = 0; const refused = []; const touched = new Set();
for (const [, key, , , yes, corrected] of parseCsv(readFileSync(file, 'utf8')).slice(1)) {
  const part = parts.find((p) => key in p.doc);
  const agreed = /^(y|yes|ok|x)$/i.test((yes ?? '').trim()); const text = (corrected ?? '').trim();
  if (!agreed && !text) continue;
  if (!part || !(key in en)) { refused.push(`${key}: not a current string`); continue; }
  if (text) {
    if (holes(text) !== holes(en[key])) { refused.push(`${key}: the correction changes the placeholders (${holes(en[key]) || 'none'} expected)`); continue; }
    part.doc[key] = text; touched.add(part); fixed++;
  } else ok++;
  status[locale][key] = { status: 'reviewed', by, date: today };
}
for (const p of touched) writeFileSync(dir + p.f, JSON.stringify(p.doc, null, 2) + '\n');
writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n');
console.log(`${locale}: ${ok} confirmed, ${fixed} corrected, ${refused.length} refused`);
for (const r of refused) console.log('  refused: ' + r);
console.log('Now run: node scripts/i18n-merge.mjs && npm run check:i18n && node scripts/translations-report.mjs');
