import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { MetaService } from './core/meta.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The mock build adds mockApiInterceptor here through environment.mock.ts.
    provideHttpClient(withFetch(), withInterceptors(environment.httpInterceptors)),
    // withComponentInputBinding() passes route parameters (such as :partnerId) to inputs.
    provideRouter(routes, withComponentInputBinding()),
    // Bootstrapping waits for GET /api/meta, so every page has the time zone and date range.
    provideAppInitializer(() => inject(MetaService).load()),
  ],
};
