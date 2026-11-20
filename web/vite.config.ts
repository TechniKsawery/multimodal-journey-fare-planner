import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

// Tariff tables in data/ carry long documentation fields (keys starting with "_": sources, audit
// notes, many third-party URLs). The calculators never read them, so they are stripped from the
// bundle: smaller download, and the Pages build scan only sees hosts that are really used.
const stripDocKeys = (): Plugin => ({
  name: 'strip-data-doc-keys',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]data[\\/].*\.json$/.test(id)) return null;
    const drop = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(drop)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, drop(x)]))
          : v;
    return { code: JSON.stringify(drop(JSON.parse(code))), map: null };
  },
});

export default defineConfig({
  // vitest config lives here too (node env, pure logic tests only)
  // @ts-expect-error vitest augments the config type
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  base: './',
  // core/ and data/ live next to web/ (imported, never copied)
  server: { fs: { allow: ['..'] } },
  plugins: [stripDocKeys(), preact()],
  build: {
    target: 'es2022',
    // second page: standalone Transitous routing prototype (CORS / budget / attribution check)
    rollupOptions: { input: { main: 'index.html', transitous: 'transitous-proto.html' } },
  },
});
