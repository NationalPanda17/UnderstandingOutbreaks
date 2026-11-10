// Copies self-hosted tool runtimes into the local mirror of the R2 bucket (public/r2/tools).
// Files here exceed Cloudflare Pages' 25 MB per-file limit or its file-count comfort zone, so in production they are
// uploaded to R2 (see README "Hosting workbench and sandbox assets") and loaded from config/site.json: toolAssetsBaseUrl.
// No third-party CDN is ever used at runtime.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public', 'r2', 'tools');
const manifest = { generated: new Date().toISOString(), tools: {} };
const copy = (tool, from, files) => {
  const dir = join(out, tool); mkdirSync(dir, { recursive: true });
  manifest.tools[tool] = { files: {} };
  for (const f of files) {
    const src = join(root, 'node_modules', from, f);
    if (!existsSync(src)) { console.warn(`[tools] missing ${src}`); continue; }
    cpSync(src, join(dir, f.split('/').pop()));
    manifest.tools[tool].files[f.split('/').pop()] = statSync(src).size;
  }
};
copy('duckdb', '@duckdb/duckdb-wasm/dist', ['duckdb-eh.wasm', 'duckdb-browser-eh.worker.js']);
// DuckDB's Parquet reader is a separate extension that DuckDB-WASM downloads on first use. Left alone it fetches it
// from extensions.duckdb.org at runtime, which is a third-party request the site forbids (and its CSP blocks). So the
// extension is fetched once here, at build time, checked against a pinned SHA-256, and self-hosted beside the engine;
// the SQL console points DuckDB at that copy. The version must match the engine: update both pins together.
{
  const EXT = { duckdb: 'v1.5.4', platform: 'wasm_eh', name: 'parquet', sha256: '4845705bbd69fc9ad52878d96a505c73cae4a6c509822079cc2413e5eb437f95' };
  const rel = `${EXT.duckdb}/${EXT.platform}/${EXT.name}.duckdb_extension.wasm`;
  const dst = join(out, 'duckdb', 'extensions', rel);
  const ok = (buf) => createHash('sha256').update(buf).digest('hex') === EXT.sha256;
  if (!existsSync(dst) || !ok(readFileSync(dst))) {
    const r = await fetch(`https://extensions.duckdb.org/${rel}`);
    if (!r.ok) throw new Error(`[tools] could not fetch the DuckDB ${EXT.name} extension: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!ok(buf)) throw new Error(`[tools] DuckDB ${EXT.name} extension does not match its pinned SHA-256; refusing to use it`);
    mkdirSync(join(dst, '..'), { recursive: true }); writeFileSync(dst, buf);
  }
  manifest.tools.duckdb.files[`extensions/${rel}`] = statSync(dst).size;
  manifest.tools.duckdb.extensionVersion = EXT.duckdb;
}
// webR (R in the browser): the whole runtime directory, minus tests, the demo REPL and source maps.
{
  const src = join(root, 'node_modules', 'webr', 'dist');
  if (existsSync(src)) {
    const dst = join(out, 'webr');
    cpSync(src, dst, { recursive: true, filter: (f) => !/\/(tests|repl)(\/|$)/.test(f) && !/\.(map|d\.ts|cjs)$/.test(f) });
    let bytes = 0; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) walk(p); else bytes += st.size; } }; walk(dst);
    manifest.tools.webr = { bytes };
  }
}
// Starter notebooks: served as plain files so they can be downloaded as .ipynb / .qmd even where no runtime is installed.
{
  const src = join(root, '..', 'notebooks');
  if (existsSync(src)) cpSync(src, join(root, 'public', 'notebooks'), { recursive: true, filter: (f) => !/\.ipynb_checkpoints|__pycache__|\/out(\/|$)/.test(f) });
}
// JupyterLite is built separately (scripts/build-jupyterlite.sh) into public/r2/tools/jupyterlite.
manifest.tools.jupyterlite = { installed: existsSync(join(out, 'jupyterlite', 'lab', 'index.html')) };
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('[tools]', JSON.stringify(manifest.tools));
