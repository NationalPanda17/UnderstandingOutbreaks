// Live-site health check. Opens the deployed site in a real browser, the way a visitor would, and checks the
// things that only break in production: the map, search, the SQL console (which loads a 38 MB engine from the
// assets address), an embed, how fresh the data is, and that nothing is loaded from anyone else's servers.
//
//   node check.mjs [base-url]        default: baseUrl in config/site.json
//
// Exit code 0 = healthy, 1 = at least one check failed. A Markdown report is written to health-report.md.
// It only reads the public site. It changes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const site = JSON.parse(readFileSync(new URL('../config/site.json', import.meta.url), 'utf8'));
const BASE = (process.argv[2] ?? site.baseUrl).replace(/\/$/, '');
const allowedHosts = new Set([new URL(BASE).host, ...[site.r2BaseUrl, site.toolAssetsBaseUrl, site.basemapUrl].filter((u) => /^https?:/.test(u ?? '')).map((u) => new URL(u).host)]);
const MAX_DATA_AGE_DAYS = 3;

const results = [];
const foreign = new Map();   // host -> first URL seen
const blocked = new Set();   // third-party scripts the site's own policy refused to load
async function check(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ name, ok: true, detail: detail ?? '', ms: Date.now() - t0 }); }
  catch (e) { results.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0].slice(0, 300), ms: Date.now() - t0 }); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();
page.on('response', (r) => {
  const u = r.url();
  if (!/^https?:/.test(u)) return;
  const h = new URL(u).host;
  if (!allowedHosts.has(h) && !foreign.has(h)) foreign.set(h, u);
});
page.on('console', (m) => { const x = m.text().match(/Loading the script '(https?:\/\/[^/']+)/); if (x && /Content Security Policy/.test(m.text())) blocked.add(x[1]); });

await check('Home page loads and the map draws', async () => {
  await page.goto(`${BASE}/en/`, { waitUntil: 'domcontentloaded' });
  await page.locator('h1').first().waitFor({ timeout: 30000 });
  // either the lightweight SVG map (many country shapes) or the interactive map's canvas
  await page.waitForFunction(() => document.querySelectorAll('#overview-map svg.staticmap path').length > 100 || !!document.querySelector('#overview-map .map canvas'), null, { timeout: 45000 });
  const n = await page.locator('#overview-map svg.staticmap path').count();
  const filled = await page.evaluate(() => [...document.querySelectorAll('#overview-map svg.staticmap path')].filter((p) => !(p.getAttribute('fill') ?? '').startsWith('url')).length);
  if (n > 0 && filled < 20) throw new Error(`map drew ${n} shapes but only ${filled} have a value`);
  return n > 0 ? `static map, ${n} shapes, ${filled} with a value` : 'interactive map';
});

await check('Search finds "cholera yemen"', async () => {
  const box = page.locator('#site-search');
  await box.click();
  await box.fill('cholera yemen');
  const first = page.locator('#site-search-list li').first();
  await first.waitFor({ timeout: 15000 });
  const text = (await first.innerText()).replace(/\s+/g, ' ');
  if (!/cholera/i.test(text) || !/yemen/i.test(text)) throw new Error(`first result was "${text}"`);
  await box.press('Enter');
  await page.waitForURL(/\/place\/YEM/, { timeout: 15000 });
  return text;
});

await check('SQL console runs its default query', async () => {
  await page.goto(`${BASE}/en/workbench/sql`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="sql-run"]').click({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('main table tbody tr').length > 0 || /The query failed/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 120000 });
  const text = await page.locator('main').innerText();
  const failed = text.match(/The query failed\.?\s*([^\n]*)/);
  if (failed) throw new Error(`query failed: ${failed[1]}`);
  return `${await page.locator('main table tbody tr').count()} rows`;
});

await check('A chart embed renders', async () => {
  await page.goto(`${BASE}/embed/en/chart?d=measles&c=IND`, { waitUntil: 'domcontentloaded' });
  await page.locator('main svg path').first().waitFor({ timeout: 30000 });
  const text = await page.locator('main').innerText();
  if (!/Measles/.test(text)) throw new Error('embed has no "Measles" title');
  return text.split('\n')[0];
});

await check(`Data was updated in the last ${MAX_DATA_AGE_DAYS} days`, async () => {
  const r = await ctx.request.get(`${BASE}/data/v1/manifest.json`);
  if (!r.ok()) throw new Error(`manifest.json returned ${r.status()}`);
  const m = await r.json();
  const age = (Date.now() - Date.parse(m.generated_at)) / 86400000;
  if (!(age < MAX_DATA_AGE_DAYS)) throw new Error(`data was generated ${age.toFixed(1)} days ago (${m.generated_at}); the daily update may have stopped`);
  return `generated ${m.generated_at} (${age.toFixed(1)} days ago), snapshot ${m.snapshot_id}`;
});

await check('Nothing is loaded from other servers', async () => {
  if (foreign.size) throw new Error([...foreign].map(([h, u]) => `${h} (${u.slice(0, 80)})`).join('; '));
  return [...allowedHosts].join(', ');
});

await browser.close();

const failed = results.filter((r) => !r.ok);
const lines = [`# Live-site health check: ${failed.length ? `${failed.length} of ${results.length} checks failed` : 'all checks passed'}`, '',
  `Site: ${BASE}  `, `Checked: ${new Date().toISOString()}`, '', '| Check | Result | Detail |', '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? 'passed' : '**FAILED**'} | ${r.detail.replace(/\|/g, '\\|')} |`), ''];
if (blocked.size) lines.push(`Note: the site's security policy blocked a third-party script from loading (${[...blocked].join(', ')}). Nothing was sent, but something is trying to add it to the pages.`, '');
writeFileSync(new URL('./health-report.md', import.meta.url), lines.join('\n'));
console.log(lines.join('\n'));
process.exit(failed.length ? 1 : 0);
