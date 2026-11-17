import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
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
  console.log('\nLanding Cloner\n1. Buka dashboard\n2. Buka folder output\n3. Keluar');
  const choice = (await readline.question('Pilih: ')).trim();
  if (choice === '1') open(dashboard);
  else if (choice === '2') open(output);
  else if (choice === '3') close();
  else console.log('Pilihan tidak valid.');
}
