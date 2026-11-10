import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

/** Dev-only: serve the embed shell for /embed/* (production uses _redirects written by scripts/postbuild.mjs). */
function embedRewrite(): Plugin {
  return {
    name: 'uo-embed-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/embed\/(?!.*\.[a-z0-9]+$)/.test(req.url.split('?')[0])) req.url = '/embed.html';
        next();
      });
    },
  };
}

/** Records which source modules ended up in which chunk, so scripts/check-bundles.mjs can prove what is (not) in the main and embed bundles. */
function chunkReport(): Plugin {
  return {
    name: 'uo-chunk-report',
    generateBundle(_opts, bundle) {
      const chunks = Object.values(bundle).filter((c: any) => c.type === 'chunk').map((c: any) => ({ file: c.fileName, isEntry: c.isEntry, name: c.name, facade: c.facadeModuleId, imports: c.imports, dynamicImports: c.dynamicImports, modules: Object.keys(c.modules) }));
      this.emitFile({ type: 'asset', fileName: 'chunk-modules.json', source: JSON.stringify(chunks) });
    },
  };
}

export default defineConfig({
  plugins: [preact(), embedRewrite(), chunkReport()],
  server: { fs: { allow: [resolve(import.meta.dirname, '..')] } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), embed: resolve(import.meta.dirname, 'embed.html') },
    },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
} as any);
