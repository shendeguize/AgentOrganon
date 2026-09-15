import fs from 'node:fs';
import path from 'node:path';
import { readJSON } from './lib.mjs';

export function readTooling(root) {
  const value = readJSON(path.join(root, 'release/tooling.json'));
  if (value.schema_version !== 1) throw new Error('Unsupported tooling manifest');
  for (const [key, repository] of [['workspace', 'shendeguize/AgentOrganon'], ['core', 'shendeguize/OrganonCore']]) {
    if (!value[key] && key === 'core') continue;
    if (value[key]?.repository !== repository || !/^[a-f0-9]{40}$/.test(value[key]?.commit)) throw new Error(`Invalid fixed tooling source: ${key}`);
  }
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const value = readTooling(process.argv[2] || '.');
  if (!process.env.GITHUB_OUTPUT) throw new Error('Tooling outputs require GitHub Actions');
  for (const key of ['workspace', 'core']) if (value[key]) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value[key].commit}\n`);
}
