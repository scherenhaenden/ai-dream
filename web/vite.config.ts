import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  resolve: { mainFields: ['module'] },
  // Keep builds AOT even in environments exporting NODE_ENV=test. A JIT-only
  // production bundle cannot activate lazy routes after the dev-only compiler
  // import in main.ts is tree-shaken.
  plugins: [angular({ tsconfig: "tsconfig.app.json", jit: false })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  optimizeDeps: { include: ['@angular/compiler'] },
  build: { target: 'es2022', sourcemap: false, cssCodeSplit: true },
});
