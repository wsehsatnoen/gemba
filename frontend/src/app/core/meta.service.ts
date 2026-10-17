import { HttpClient } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Meta, Problem } from './api/types';
import { toProblem } from './problem';

/**
 * Dataset metadata from GET /api/meta: the default date range, the facility time zone,
 * the dataset label, and the minimum sample size. Loaded once at startup by
 * `provideAppInitializer` (see app.config.ts) before any page renders.
 */
@Service()
export class MetaService {
  private readonly http = inject(HttpClient);

  private readonly state = signal<Meta | null>(null);
  private readonly loadError = signal<Problem | null>(null);

  /** Null only before startup finishes or when it failed. */
  readonly meta = this.state.asReadonly();
  readonly error = this.loadError.asReadonly();

  /** Every date and time on screen is shown in this zone, whatever the viewer's zone is. */
  readonly timeZone = computed(() => this.state()?.facilityTimeZone ?? 'UTC');

  /** Never rejects, so a failed load shows an error state instead of a blank page. */
  async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.state.set(await firstValueFrom(this.http.get<Meta>('/api/meta')));
    } catch (error) {
      this.loadError.set(toProblem(error));
    }
  }

  /** The loaded metadata. Only call this where the app shell has already checked it loaded. */
  require(): Meta {
    const meta = this.state();
    if (!meta) {
      throw new Error('MetaService.require() called before /api/meta loaded');
    }
    return meta;
  }
}
