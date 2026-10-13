import { Component, DestroyRef, inject, input, linkedSignal, output } from '@angular/core';

/** How long typing must pause before the search is sent. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The partner search box. It shows `value` (the URL's `q`) and emits `searched` 300 ms after
 * typing stops, or at once on Enter. The page decides what a search does.
 */
@Component({
  selector: 'g-partner-search',
  template: `
    <form role="search" (submit)="submit($event)">
      <label class="visually-hidden" for="partner-search">Search partners</label>
      <input
        #box
        id="partner-search"
        class="control"
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="Search partner ID"
        [value]="text()"
        (input)="onInput(box.value)"
      />
    </form>
  `,
  styles: `
    input {
      width: 15rem;
      max-width: 100%;
    }
  `,
})
export class PartnerSearch {
  /** The current search text from the URL. */
  readonly value = input('');
  readonly searched = output<string>();

  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The last text this box sent, so the URL catching up doesn't overwrite newer typing. */
  private sent: string | null = null;

  /**
   * What the box shows. It follows the URL (back, forward, "Clear filters"), except when
   * the URL only caught up with text this box sent while the person kept typing.
   */
  protected readonly text = linkedSignal<string, string>({
    source: this.value,
    computation: (value, previous) =>
      previous !== undefined && value === this.sent ? previous.value : value,
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected onInput(text: string): void {
    this.text.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emit(text), SEARCH_DEBOUNCE_MS);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    clearTimeout(this.timer);
    this.emit(this.text());
  }

  private emit(text: string): void {
    this.sent = text.trim();
    this.searched.emit(this.sent);
  }
}
