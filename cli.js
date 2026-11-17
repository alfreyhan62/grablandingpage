import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const color = {
  reset: '\x1b[0m',
  purple: '\x1b[38;5;141m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  muted: '\x1b[90m',
  red: '\x1b[31m',
  bold: '\x1b[1m'
};
const paint = (text, ...styles) => `${styles.join('')}${text}${color.reset}`;
const dashboard = 'http://127.0.0.1:4173';
const output = path.join(root, 'output');
const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], { stdio: 'inherit' });
const readline = createInterface({ input: stdin, output: stdout });

const open = (target) => {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
};

const close = () => {
  readline.close();
  server.kill();
};

server.once('exit', (code) => {
  if (code && !readline.closed) console.error(`Server berhenti dengan kode ${code}.`);
  close();
});

process.on('SIGINT', close);

while (!readline.closed) {
  console.log(`\n${paint('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color.purple)}`);
  console.log(paint('         LANDING CLONER', color.bold, color.purple));
  console.log(paint('  Capture landing page publik lokal', color.muted));
  console.log(paint('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color.purple));
  console.log(`\n  ${paint('[1]', color.cyan, color.bold)} ${paint('Buka dashboard', color.bold)}`);
  console.log(`  ${paint('[2]', color.yellow, color.bold)} ${paint('Buka folder output', color.bold)}`);
  console.log(`  ${paint('[3]', color.red, color.bold)} ${paint('Keluar', color.bold)}`);
  const choice = (await readline.question(`\n${paint('Pilih', color.green, color.bold)} ${paint('›', color.purple)} `)).trim();
  if (choice === '1') {
    open(dashboard);
    console.log(paint(`Dashboard dibuka: ${dashboard}`, color.green));
  } else if (choice === '2') {
    open(output);
    console.log(paint('Folder output dibuka.', color.green));
  } else if (choice === '3') close();
  else console.log(paint('Pilihan tidak valid.', color.red));
}
