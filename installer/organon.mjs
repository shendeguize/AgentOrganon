#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exists } from './lib/files.mjs';
import { install, check, initialize, rollback, uninstall } from './lib/lifecycle.mjs';

const help = `organon <install|check|init|update|rollback|uninstall>\n  --product agent-organon|core|advised --agent codex|claude|cursor|copilot|gemini|opencode\n  --scope project|global [--project PATH] [--domain SoftwareEngineering]\n  install/update: [--from PACKAGE.tgz|DIRECTORY] [--version EXACT]\n  init: --project PATH --philosophy core|SoftwareEngineering [--apply --plan-sha256 HASH]\n\nInstall changes skill availability. Init previews adoption; apply requires the returned planSha256.\nRegistry installs require an exact version. Local packages work offline.\n`;
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ['--help', 'help'].includes(argv[0])) return { help };
  const command = argv.shift();
  if (!['install', 'check', 'init', 'update', 'rollback', 'uninstall'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = {};
  const allowed = ['product', 'agent', 'scope', 'project', 'domain', 'version', 'from', 'philosophy', 'apply', 'plan-sha256'];
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].replace(/^--/, '');
    if (!argv[index].startsWith('--') || !allowed.includes(key) || Object.hasOwn(options, key)) throw new Error(`Unknown or repeated option: ${argv[index]}`);
    if (key === 'apply') options.apply = true;
    else {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing value: --${key}`);
      options[key] = argv[++index];
    }
  }
  if (options.apply && command !== 'init') throw new Error('--apply is only valid for init');
  const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bundled = exists(path.join(candidate, 'organon-content.json')) ? candidate : undefined;
  if (command === 'install' || command === 'update') return install(options, { bundled, update: command === 'update' });
  if (command === 'check') return check(options);
  if (command === 'init') return initialize(options);
  if (command === 'rollback') return rollback(options);
  return uninstall(options);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { process.stderr.write(`${JSON.stringify({ error: error.message })}\n`); process.exitCode = 1; });
}
