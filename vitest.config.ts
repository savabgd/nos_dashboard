import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.config.*', '**/*.test.*', '**/*.spec.*'],
    },
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    extensions: ['.mts', '.ts', '.mjs', '.js', '.jsx', '.tsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  define: {
    'process.env': {
      VITE_API_BASE_URL: JSON.stringify('http://localhost:8080'),
      VITE_AUTO_REFRESH_INTERVAL: JSON.stringify('300000'),
    },
  },
});