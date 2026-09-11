import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Serves the orbit snapshot the pipeline writes to data/orbits/latest/ at /data/orbits/…
 * during development and preview. The pipeline's output never enters web/public or git;
 * in production the same paths will be served from object storage with the same cache
 * headers: the manifest is always revalidated, versioned files are immutable.
 */
const ORBITS_DIR = fileURLToPath(new URL('../data/orbits/latest/', import.meta.url));

function serveOrbitData(): Plugin {
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return next();
    const file = path.join(ORBITS_DIR, name);
    try {
      const st = await stat(file);
      if (!st.isFile()) return next();
      const body = await readFile(file);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', name === 'manifest.json' ? 'no-cache' : 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', body.length);
      res.end(body);
    } catch {
      next();
    }
  };
  return {
    name: 'serve-orbit-data',
    configureServer(server) {
      server.middlewares.use('/data/orbits', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data/orbits', handler);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), serveOrbitData()],
  // Module workers, so the propagation worker can code-split like the page does (and the
  // satellite.js WASM runtimes it never asks for stay out of its bundle).
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
