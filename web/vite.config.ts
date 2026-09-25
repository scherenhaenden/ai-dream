import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  resolve: { mainFields: ['module'] },
  plugins: [angular({ tsconfig: "tsconfig.app.json" })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  optimizeDeps: { include: ['@angular/compiler'] },
  build: { target: 'es2022', sourcemap: false, cssCodeSplit: true },
});
