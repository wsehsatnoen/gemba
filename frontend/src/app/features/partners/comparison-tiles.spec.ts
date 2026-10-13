import { TestBed } from '@angular/core/testing';
import type { ComparisonCell } from '../../core/api/types';
import { ComparisonTiles, tileLabel } from './comparison-tiles';

const cell = (over: Partial<ComparisonCell>): ComparisonCell => ({
  zone: 'AMBIENT',
  taskType: 'CYCLE_COUNT',
  taskCount: 318,
  partnerMedianMs: 43000,
  facilityMedianMs: 48000,
  pacePct: 111.6,
  comparison: 'FASTER',
  ...over,
});

describe('ComparisonTiles', () => {
  async function create(cells: ComparisonCell[], minSampleSize = 20) {
    const fixture = TestBed.createComponent(ComparisonTiles);
    fixture.componentRef.setInput('cells', cells);
    fixture.componentRef.setInput('minSampleSize', minSampleSize);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return [...el.querySelectorAll('li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
  }

  async function headings(cells: ComparisonCell[]) {
    const fixture = TestBed.createComponent(ComparisonTiles);
    fixture.componentRef.setInput('cells', cells);
    fixture.componentRef.setInput('minSampleSize', 20);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return [...el.querySelectorAll('h3')].map((h) => h.textContent);
  }

  it('shows the cells in the fixed order, whatever order the API sends', async () => {
    const labels = await headings([
      cell({ zone: 'CHILLED', taskType: 'BIN_MAINTENANCE' }),
      cell({ zone: 'AMBIENT', taskType: 'BIN_MAINTENANCE' }),
      cell({ zone: 'CHILLED', taskType: 'CYCLE_COUNT' }),
      cell({}),
    ]);
    expect(labels).toEqual([
      'Ambient cycle count',
      'Chilled cycle count',
      'Ambient bin maintenance',
      'Chilled bin maintenance',
    ]);
  });

  it('shows the medians and the task count', async () => {
    const [tile] = await create([cell({})]);
    expect(tile).toContain('112%');
    expect(tile).toContain('0:43 vs 0:48');
    expect(tile).toContain('318 tasks');
  });

  it('shows only the cells the API returned', async () => {
    const tiles = await create([cell({ zone: 'CHILLED' })]);
    expect(tiles.length).toBe(1);
    expect(tiles[0]).toContain('Chilled cycle count');
  });

  it('shows "Too few" and the minimum sample from meta for a small sample', async () => {
    const [tile] = await create(
      [
        cell({
          partnerMedianMs: null,
          pacePct: null,
          taskCount: 9,
          comparison: 'INSUFFICIENT_SAMPLE',
        }),
      ],
      25,
    );
    expect(tile).toContain('Too few');
    expect(tile).toContain('Needs 25 tasks');
    expect(tile).toContain('9 tasks');
    expect(tile).not.toContain(' vs ');
  });

  it('labels a tile in sentence case', () => {
    expect(tileLabel('CHILLED', 'BIN_MAINTENANCE')).toBe('Chilled bin maintenance');
  });
});
