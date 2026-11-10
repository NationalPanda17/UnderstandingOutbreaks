// Lists translation keys used in the source: literal keys, and prefixes of dynamically built keys.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
walk(new URL('../src', import.meta.url).pathname);
export const literal = new Set(); export const prefixes = new Set();
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*'([^']+)'\s*[,)]/g)) literal.add(m[1]);
  for (const m of s.matchAll(/\bt\(\s*'([^']+)'\s*\+/g)) prefixes.add(m[1]);
  for (const m of s.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)) prefixes.add(m[1]);
  for (const m of s.matchAll(/key: '([a-z]+\.[A-Za-z.]+)'/g)) literal.add(m[1]);
  for (const m of s.matchAll(/base="([a-z]+(?:\.[A-Za-z]+)*)"/g)) prefixes.add(m[1] + '.');
}
if (process.argv[1].endsWith('extract-keys.mjs')) { console.log([...literal].sort().join('\n')); console.log('--- prefixes'); console.log([...prefixes].sort().join('\n')); }
