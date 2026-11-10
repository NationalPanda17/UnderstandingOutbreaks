// Writes TRANSLATIONS.md: review status of every string, per locale, with health-related wording listed first.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const site = JSON.parse(readFileSync(root + '../config/site.json', 'utf8'));
const load = (l) => JSON.parse(readFileSync(`${root}src/i18n/locales/${l}.json`, 'utf8'));
const en = load(site.defaultLocale);
let reviewed = {};
try { reviewed = JSON.parse(readFileSync(root + 'src/i18n/review-status.json', 'utf8')); } catch { /* nothing reviewed yet */ }
// Priority groups: health-related wording first (summaries, caveats, glossary, flag explanations, reporter's guide, tours,
// tool warnings, simulation disclaimers, model assumptions, lessons, trace-panel explanations).
const GROUPS = [
  ['Positioning, disclaimers and persistent notices', /^(footer\.(positioning|medical)|persist\.|embed\.disclaimer|about\.not\.|methodology\.scope\.)/],
  ['Event summaries and status wording', /^(event\.sum\.|event\.(summaryNote|automated)|status\.|statusbasis\.|outbreak\.(countsNote|precisionNote|statusQuote))/],
  ['Caveats and "what this means" text', /(\.means(\.|$)|\.caveat|Caveat|^chart\.incomplete|^overview\.means|^place\.means|^disease\.(globalMeans|topCaveat)|^changes\.moversCaveat|^pin\.vintage)/],
  ['Signal-flag explanations', /^(flags\.|flagstatus\.|method\.rolling_baseline_c2|tour\.flag\.)/],
  ['Glossary', /^glossary\./],
  ["Reporter's guide", /^guide\./],
  ['Guided tours', /^tour\./],
  ['Tool warnings and safeguards', /^(warn\.|guard\.|firstuse\.|overlay\.(local|localTitle|exportNote|warn|err)|workbench\.smallScreen)/],
  ['Simulation disclaimers', /^(sim\.(banner|bannerMore|notFitted|watermarkShort|simulated|smallScreen)|notpred\.|shape\.notice|meta\.notice|preset\.(illustrative|noRange|unverifiedParams)|challenge\.puzzle|sweep\.frame|learn\.separateBody)/],
  ['Model assumption text', /^(assume\.|template\..*\.note|age\.note|doc\.plain|ngm\.intro)/],
  ['Lessons, misconceptions, challenges and scenarios', /^(lesson\.|mis\.|challenge\.|scenario\.|obs\.)/],
  ['Trace-panel explanations', /^(trace\.|origin\.|chain\.|method\.|transform\..*\.explain)/],
  ['Methodology, about, citation and quality text', /^(methodology\.|about\.|cite\.|quality\.notes)/],
];
const groupOf = (k) => (GROUPS.find(([, re]) => re.test(k)) ?? ['Interface strings (lower priority)'])[0];
const order = [...GROUPS.map((g) => g[0]), 'Interface strings (lower priority)'];
const L = ['# Translations', '',
  'English is the source language. **Spanish, French and German were machine-drafted and have not been professionally translated.** Every string below is flagged for human review until a reviewer records it in `site/src/i18n/review-status.json`.', '',
  'Health-related wording is the priority for review and is listed first: summaries, caveats, glossary, signal-flag explanations, the reporter\'s guide, guided tours, tool warnings, simulation disclaimers, model assumption text, lessons and trace-panel explanations.', '',
  'Source titles, notices and quoted phrases are never translated; they are shown in their original language with a link.', '',
  '## How to review', '',
  '1. Edit the string in `site/src/i18n/locales/<locale>.json`.',
  '2. Add the key to `site/src/i18n/review-status.json` under the locale, e.g. `{"es": {"footer.positioning": {"status": "reviewed", "by": "native speaker, public health", "date": "YYYY-MM-DD"}}}`.',
  '3. Run `node site/scripts/translations-report.mjs` and `npm run check:i18n`.', '',
  '## Adding a language', '', 'Drop a translated copy of `en.json` into `site/src/i18n/locales/` and add one line to `locales` in `config/site.json`. No code changes; right-to-left scripts set `"dir": "rtl"`.', '',
  '## Status summary', '', '| Locale | Language | Status | Strings | Reviewed | Awaiting review |', '|---|---|---|---|---|---|'];
const detail = [];
for (const loc of site.locales) {
  if (loc.code === site.defaultLocale) { L.push(`| ${loc.code} | ${loc.name} | source | ${Object.keys(en).length} | – | – |`); continue; }
  const msgs = load(loc.code); const rev = reviewed[loc.code] ?? {};
  const keys = Object.keys(en); const done = keys.filter((k) => rev[k]?.status === 'reviewed');
  L.push(`| ${loc.code} | ${loc.name} | ${loc.status} | ${keys.length} | ${done.length} | ${keys.length - done.length} |`);
  detail.push('', `## ${loc.name} (${loc.code}): strings by review status`, '');
  const by = new Map(order.map((g) => [g, []])); for (const k of keys) by.get(groupOf(k)).push(k);
  for (const g of order) {
    const ks = by.get(g); if (!ks.length) continue;
    const pending = ks.filter((k) => rev[k]?.status !== 'reviewed'); const missing = ks.filter((k) => !(k in msgs));
    detail.push(`### ${g}`, '', `${ks.length} strings: ${ks.length - pending.length} reviewed, ${pending.length} machine-drafted and awaiting review${missing.length ? `, ${missing.length} missing` : ''}.`, '');
    if (g !== 'Interface strings (lower priority)') detail.push('<details><summary>Keys awaiting review</summary>', '', pending.map((k) => '`' + k + '`').join(', '), '', '</details>', '');
    else detail.push(`Keys awaiting review: all keys in \`${loc.code}.json\` not listed in a priority group above.`, '');
  }
}
writeFileSync(root + '../TRANSLATIONS.md', [...L, ...detail].join('\n') + '\n');
console.log('wrote TRANSLATIONS.md');
