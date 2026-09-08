/**
 * start-all.js — One command to run the whole stack.
 *
 *   npm start
 *
 * Spawns the PWA static server (8080) and the sync API (4000), tags their
 * output, and shuts both down together on Ctrl-C.
 *
 * @module tools/start-all
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** @type {{name:string, color:string, command:string[], cwd:string}[]} */
const services = [
  {
    name: 'PWA  ',
    color: '\x1b[36m', // cyan
    command: [process.execPath, path.join(ROOT, 'tools', 'dev-server.js'), '8080'],
    cwd: ROOT,
  },
  {
    name: 'API  ',
    color: '\x1b[35m', // magenta
    command: [process.execPath, path.join(ROOT, 'server', 'src', 'server.js')],
    cwd: ROOT,
  },
];

const RESET = '\x1b[0m';
const children = [];

/** Prefix each line of a child's output with its service name. */
function pipe(stream, service) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      console.log(`${service.color}[${service.name}]${RESET} ${line}`);
    }
  });
}

for (const service of services) {
  const [bin, ...args] = service.command;
  const child = spawn(bin, args, { cwd: service.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  pipe(child.stdout, service);
  pipe(child.stderr, service);
  child.on('exit', (code) => {
    console.log(`${service.color}[${service.name}]${RESET} exited with code ${code}`);
  });
  children.push(child);
}

console.log('\n  DigiPoke is running:');
console.log('    PWA   http://localhost:8080/');
console.log('    API   http://localhost:4000/v1/health');
console.log('\n  Ctrl-C stops both.\n');

/** Tear everything down. */
function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 400).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
