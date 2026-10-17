import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Settings for the real builds (production and `npm start`).
 * The `mock` build configuration swaps this file for `environment.mock.ts`
 * (see `fileReplacements` in angular.json), so mock code never reaches production.
 */
export const environment = {
  apiDocsUrl: '/api/docs',
  repoUrl: 'https://github.com/wsehsatnoen/gemba',
  httpInterceptors: [] as HttpInterceptorFn[],
};
