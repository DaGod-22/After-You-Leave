import { defineConfig } from 'vite';

// The dev and preview servers listen on all interfaces so the sandbox preview can reach them.
// allowedHosts is enabled because the preview is served from a generated host name.
export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { chunkSizeWarningLimit: 1200, target: 'es2020' },
});
