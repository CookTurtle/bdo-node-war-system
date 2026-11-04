// Prepares the local environment. Safe to run repeatedly; `npm run dev` runs it every time.
// Only ever touches the local database: there is deliberately no --remote here.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_NAME = 'bdo-local';
const STATE_DIR = join(root, '.wrangler', 'state');
const D1_DIR = join(STATE_DIR, 'v3', 'd1');
const WRANGLER = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

if (!existsSync(WRANGLER)) {
  console.error('Wrangler is not installed. Run "npm install" first.');
  process.exit(1);
}

function copyIfMissing(example, target) {
  if (existsSync(join(root, target))) return;
  copyFileSync(join(root, example), join(root, target));
  console.log(`Created ${target} from ${example}`);
}

function wrangler(...args) {
  // CI=true stops Wrangler asking for confirmation before applying migrations.
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: root,
    env: { ...process.env, CI: 'true' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    console.error(`\nFailed: wrangler ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

copyIfMissing('wrangler.toml.example', 'wrangler.toml');
copyIfMissing('.dev.vars.example', '.dev.vars');

if (process.argv.includes('--reset')) {
  rmSync(STATE_DIR, { recursive: true, force: true });
  console.log('Deleted the local database.');
}

// Seed only a brand-new database, so restarting never brings back data you deleted.
const isNewDatabase = !existsSync(D1_DIR);

wrangler('d1', 'migrations', 'apply', DB_NAME, '--local');
console.log('Local database schema is up to date.');

if (isNewDatabase) {
  wrangler('d1', 'execute', DB_NAME, '--local', '--file=seeds/dev.sql');
  console.log('Added sample data. Run "npm run token" for how to log in as the local admin.');
}
