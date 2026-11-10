// Copies self-hosted tool runtimes into the local mirror of the R2 bucket (public/r2/tools).
// Files here exceed Cloudflare Pages' 25 MB per-file limit or its file-count comfort zone, so in production they are
// uploaded to R2 (see README "Hosting workbench and sandbox assets") and loaded from config/site.json: toolAssetsBaseUrl.
// No third-party CDN is ever used at runtime.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
