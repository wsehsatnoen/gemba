// Fails if the production build contains mock code. Run by `npm run check:prod`
// after `ng build --configuration production`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Must match MOCK_MARKER in src/mocks/marker.ts.
const MARKER = 'gemba-mock-fixtures-7c1e';
const DIST = 'dist';

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const offenders = files(DIST).filter((path) => readFileSync(path, 'utf8').includes(MARKER));

if (offenders.length > 0) {
  console.error(`Mock code found in the production build:\n  ${offenders.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:prod passed: no mock marker in ${DIST}/.`);
