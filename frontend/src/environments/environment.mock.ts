import { HttpInterceptorFn } from '@angular/common/http';
import { mockApiInterceptor } from '../mocks/mock-api.interceptor';

/** Settings for `npm run start:mock`: `/api/*` is answered from the fixtures in `src/mocks/`. */
export const environment = {
  apiDocsUrl: '/api/docs',
  repoUrl: 'https://github.com/wsehsatnoen/gemba',
  httpInterceptors: [mockApiInterceptor] as HttpInterceptorFn[],
};
