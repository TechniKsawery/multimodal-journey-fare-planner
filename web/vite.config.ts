import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // vitest config lives here too (node env, pure logic tests only)
  // @ts-expect-error vitest augments the config type
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2020',
    // second page: standalone Transitous routing prototype (CORS / budget / attribution check)
    rollupOptions: { input: { main: 'index.html', transitous: 'transitous-proto.html' } },
  },
});
