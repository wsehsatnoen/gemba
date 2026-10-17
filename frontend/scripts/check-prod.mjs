// Fails if the production build contains mock code. Run by `npm run check:prod`
// after `ng build --configuration production`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// MOCK_MARKER from src/mocks/marker.ts (the interceptor), plus IDs that only appear in the
// fixtures, so a fixture that leaks in without the interceptor is caught too.
const MARKERS = ['gemba-mock-fixtures-7c1e', 'SIMUSR0142', 'SIMTU004417'];
const DIST = 'dist';

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const offenders = files(DIST).filter((path) =>
  MARKERS.some((marker) => readFileSync(path, 'utf8').includes(marker)),
);

if (offenders.length > 0) {
  console.error(`Mock code found in the production build:\n  ${offenders.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:prod passed: no mock marker in ${DIST}/.`);
