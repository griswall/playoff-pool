import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const defaults = JSON.parse(readFileSync('public-config.json', 'utf8'));
const variables = process.env;
if (Boolean(variables.VITE_SUPABASE_URL) !== Boolean(variables.VITE_SUPABASE_ANON_KEY)) {
  throw new Error('Configure both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}
const url = new URL(variables.VITE_SUPABASE_URL || defaults.url);
if (url.protocol !== 'https:' || url.href !== url.origin + '/')
  throw new Error('Expected an HTTPS Supabase project origin.');
const key = variables.VITE_SUPABASE_ANON_KEY || defaults.key;
const parts = key.split('.');
const claims =
  parts.length === 3 ? JSON.parse(Buffer.from(parts[1], 'base64url').toString()) : null;
if (!key.startsWith('sb_publishable_') && claims?.role !== 'anon')
  throw new Error('Expected a public browser key.');
if (
  claims?.ref &&
  url.hostname.endsWith('.supabase.co') &&
  url.hostname.split('.')[0] !== claims.ref
)
  throw new Error('Public key does not match the supplied project.');
const connection = {
  url: url.origin,
  key,
  allowedHost: url.origin === defaults.url ? defaults.productionHost : null,
};
const pages = ['index', 'login', 'my-teams', 'admin', 'admin_importer'];
const out = mkdtempSync(join(tmpdir(), 'hurd-pool-'));
const assets = out + '/assets';
mkdirSync(assets);
const bundle = await build({
  entryPoints: pages.map((p) => 'scripts/' + p + '.js'),
  outdir: assets,
  bundle: true,
  minify: true,
  format: 'esm',
  splitting: true,
  target: 'es2022',
  metafile: true,
  entryNames: '[name]-[hash]',
  chunkNames: 'shared-[hash]',
  define: { __POOL_CONFIG__: JSON.stringify(connection) },
});
execFileSync(
  process.execPath,
  [
    'node_modules/tailwindcss/lib/cli.js',
    '-c',
    'tailwind.config.cjs',
    '-i',
    'styles/base.css',
    '-o',
    assets + '/pool.css',
    '--minify',
  ],
  { stdio: 'inherit' },
);
const fingerprint = (name, bytes) => {
  const filename =
    name + '-' + createHash('sha256').update(bytes).digest('hex').slice(0, 12) + '.css';
  writeFileSync(assets + '/' + filename, bytes);
  return filename;
};
const shared = fingerprint('pool', readFileSync(assets + '/pool.css'));
rmSync(assets + '/pool.css');
for (const page of pages) {
  const entry = Object.entries(bundle.metafile.outputs).find(
    ([, v]) => v.entryPoint === 'scripts/' + page + '.js',
  )[0];
  const css = fingerprint(page, readFileSync('styles/' + page + '.css'));
  const html = readFileSync(page + '.html', 'utf8')
    .replace('./assets/pool.css', './assets/' + shared)
    .replace('./assets/' + page + '.css', './assets/' + css)
    .replace('./assets/' + page + '.js', './assets/' + basename(entry));
  writeFileSync(out + '/' + page + '.html', html);
}
const { cpSync } = await import('node:fs');
mkdirSync('dist', { recursive: true });
for (const name of readdirSync('dist'))
  rmSync(join('dist', name), { recursive: true, force: true });
cpSync(out, 'dist', { recursive: true });
rmSync(out, { recursive: true });
