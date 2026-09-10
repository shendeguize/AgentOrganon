import { argumentsFor, run } from './lib/cli.js';
import { check } from './lib/operations.js';
run(() => {
  const args = argumentsFor(['source'], ['source']);
  if (args.positional.length !== 1) throw new Error('Usage: node scripts/check.js [--source] FILE');
  return check(args.positional[0], { source: args.source });
});
