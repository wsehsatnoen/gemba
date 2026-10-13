import { BreakpointObserver } from '@angular/cdk/layout';
import { inject, Service } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** The desktop breakpoint from the design: 1024 px and wider. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Breakpoint signals for behavior that CSS alone can't handle (for example, whether the
 * task panel is a side panel or a full-screen view). Prefer CSS media queries for layout.
 */
@Service()
export class Viewport {
  readonly isDesktop = toSignal(
    inject(BreakpointObserver)
      .observe(DESKTOP_QUERY)
      .pipe(map((state) => state.matches)),
    { initialValue: true },
  );
}
