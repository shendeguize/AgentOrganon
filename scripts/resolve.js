import { argumentsFor, run } from './lib/cli.js';
import { resolvePhilosophy } from './lib/operations.js';
run(() => {
  const args = argumentsFor(['cwd', 'philosophy']);
  if (args.positional.length) throw new Error('Unexpected positional arguments');
  return resolvePhilosophy(args);
});
