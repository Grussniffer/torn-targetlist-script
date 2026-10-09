import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const directories = ['src', 'scripts', 'tests', 'dist'];
for (const dir of directories) {
  for (const file of await readdir(dir)) {
    if (!/\.([cm]?js)$/.test(file)) continue;
    const checked = spawnSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
    if (checked.status !== 0) process.exit(checked.status ?? 1);
  }
}
console.log('All JavaScript syntax checks passed.');
