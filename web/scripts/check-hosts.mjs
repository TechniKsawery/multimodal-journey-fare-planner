// Host allow-list check for the PWA. Single source of truth: web/allowed-hosts.json.
//
// Collects every http(s) host in the built bundle (web/dist), which is what gets published, and fails
// when one is not on the allow-list (add it deliberately, or remove the link). The sources (data/, core/,
// web/src, ...) are only scanned to tell you which file introduced the host. Allow-list entries that no
// longer appear in the bundle are reported as warnings (candidates for removal).
// Run after `npm run build`: `npm run check-hosts`.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '..');
const allowed = new Set(JSON.parse(readFileSync(join(webDir, 'allowed-hosts.json'), 'utf8')).hosts);
const URL_RE = /https?:\/\/([A-Za-z0-9.-]+)/g;
const TEXT_EXT = /\.(json|ts|tsx|js|mjs|html|css|md|webmanifest|svg|txt)$/i;

function* walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) { yield p; return; }
  for (const e of readdirSync(p)) {
    if (e === 'node_modules' || e === '.git' || e === 'schemas') continue;
    yield* walk(join(p, e));
  }
}

function collect(paths) {
  const found = new Map(); // host -> Set(files)
  for (const root of paths) {
    for (const f of walk(root)) {
      if (!TEXT_EXT.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(URL_RE)) {
        const host = m[1].replace(/\.+$/, '').toLowerCase();
        if (!found.has(host)) found.set(host, new Set());
        found.get(host).add(relative(repoDir, f));
      }
    }
  }
  return found;
}

const sources = collect([
  join(repoDir, 'data'), join(repoDir, 'core'),
  join(webDir, 'src'), join(webDir, 'public'), join(webDir, 'index.html'),
]);
if (!existsSync(join(webDir, 'dist'))) {
  console.error('web/dist not found: run `npm run build` first.');
  process.exit(2);
}
const dist = collect([join(webDir, 'dist')]);

let failed = false;
const unknown = new Map();
for (const host of dist.keys()) {
  if (allowed.has(host)) continue;
  unknown.set(host, sources.get(host) ?? dist.get(host));
}
if (unknown.size) {
  failed = true;
  console.error('::error::Hosts in the build output that are not on the allow-list (web/allowed-hosts.json):');
  for (const [host, files] of [...unknown].sort()) {
    const list = [...files].slice(0, 3).join(', ') + (files.size > 3 ? `, +${files.size - 3} more` : '');
    console.error(`  - ${host}   (seen in: ${list})`);
  }
  console.error('Fix: remove the link, or, if it is a legitimate documentation/source link (never fetched),\n' +
    'add the host to web/allowed-hosts.json in this PR.');
}

const stale = [...allowed].filter((h) => !dist.has(h)).sort();
if (stale.length) {
  console.warn(`::warning::Allow-list entries not present in the build output (consider removing from web/allowed-hosts.json): ${stale.join(', ')}`);
}

if (failed) process.exit(1);
console.log(`Host check OK (${allowed.size} allowed hosts).`);
