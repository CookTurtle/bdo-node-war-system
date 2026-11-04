// Prints a browser snippet that logs you in as the seeded local admin, so local
// development does not need a Discord app. The token is signed with SESSION_SECRET
// from .dev.vars, so it is only valid on a server using that same secret.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeToken } from '../lib/session.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const varsPath = join(root, '.dev.vars');

if (!existsSync(varsPath)) {
  console.error('.dev.vars not found. Run "npm run setup" first.');
  process.exit(1);
}

const secret = readFileSync(varsPath, 'utf8').match(/^\s*SESSION_SECRET\s*=\s*(.+?)\s*$/m)?.[1];
if (!secret) {
  console.error('SESSION_SECRET is not set in .dev.vars.');
  process.exit(1);
}

const token = await makeToken({ id: 'dev-admin', exp: Date.now() + 7 * 864e5 }, secret);

console.log('Open http://localhost:8788, press F12, and paste this into the Console:\n');
console.log(`document.cookie = "session=${token}; path=/"; location.reload();\n`);
console.log('The login lasts 7 days.');
