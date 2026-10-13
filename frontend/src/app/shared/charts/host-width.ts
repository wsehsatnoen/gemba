import { DestroyRef, ElementRef, afterNextRender, inject, signal } from '@angular/core';

/** Width used before the first measurement, and in tests (jsdom has no layout). */
export const DEFAULT_CHART_WIDTH = 640;

/**
 * The host element's width in CSS pixels, as a signal that follows resizes.
 *
 * Charts draw their SVG `viewBox` at this width so the chart fills its container while text
 * and line widths stay at their real pixel size instead of scaling with the container.
 * Call it in a component's injection context (a field initializer).
 */
export function hostWidth() {
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const width = signal(DEFAULT_CHART_WIDTH);

  // afterNextRender runs only in the browser, once the host is in the DOM.
  afterNextRender(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.floor(entry.contentRect.width);
      if (measured > 0) width.set(measured);
    });
    observer.observe(host);
    destroyRef.onDestroy(() => observer.disconnect());
  });

  return width.asReadonly();
}
