import { serialize } from './io.js';

export function argumentsFor(allowed, booleans = []) {
  const result = { positional: [] };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('--')) { result.positional.push(value); continue; }
    const key = value.slice(2);
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new Error(`Unknown or repeated option: ${value}`);
    if (booleans.includes(key)) result[key] = true;
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${value}`);
      result[key] = args[++index];
    }
  }
  return result;
}

export function run(action) {
  try { process.stdout.write(serialize(action())); }
  catch (error) { process.stderr.write(`${serialize({ error: error.message })}`); process.exitCode = 1; }
}
