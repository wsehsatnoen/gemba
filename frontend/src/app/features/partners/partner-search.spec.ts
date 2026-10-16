import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PartnerSearch, SEARCH_DEBOUNCE_MS } from './partner-search';

@Component({
  imports: [PartnerSearch],
  template: `<g-partner-search [value]="value()" (searched)="sent.push($event)" />`,
})
class Host {
  readonly value = signal('');
  readonly sent: string[] = [];
}

describe('PartnerSearch', () => {
  afterEach(() => vi.useRealTimers());

  async function create(value = '') {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.value.set(value);
    await fixture.whenStable();
    // Fake timers only after the first render, which waits on real ones.
    vi.useFakeTimers();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const type = (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    };
    return { fixture, input, type, host: fixture.componentInstance };
  }

  it('shows the URL value and has an accessible name', async () => {
    const { input, fixture } = await create('0142');
    expect(input.value).toBe('0142');
    const label = fixture.nativeElement.querySelector(`label[for="${input.id}"]`);
    expect(label.textContent).toBe('Search partners');
  });

  it('sends the search 300 ms after typing stops', async () => {
    const { type, host } = await create();
    type('SIM');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    type('SIMUSR01');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(host.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.sent).toEqual(['SIMUSR01']);
  });

  it('sends at once on Enter, trimmed', async () => {
    const { type, host, fixture } = await create();
    type(' 0142 ');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    expect(host.sent).toEqual(['0142']);
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(host.sent).toEqual(['0142']);
  });

  it('follows the URL when it changes elsewhere', async () => {
    const { input, fixture, host } = await create('0142');
    vi.useRealTimers();
    host.value.set('');
    await fixture.whenStable();
    expect(input.value).toBe('');
  });
});
