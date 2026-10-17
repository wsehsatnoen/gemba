import { A11yModule } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import type { TaskType, Zone } from '../core/api/types';
import { TASK_TYPES, ZONES } from '../core/api/types';
import { FilterName, FilterState } from '../core/filter-state';
import { DateRangePipe, isDateOnly } from '../core/format';
import { TASK_TYPE_LABELS, ZONE_LABELS } from '../core/labels';
import { MetaService } from '../core/meta.service';
import { Viewport } from '../core/viewport';

const FILTER_NAMES: Record<FilterName, string> = {
  from: 'start date',
  to: 'end date',
  zone: 'zone',
  taskType: 'task type',
};

/**
 * The filter bar on every page: a date range, a zone menu, and a task type menu.
 * Values come from and go to the URL through FilterState. On desktop the date range opens
 * a small dialog; under 1024 px the filters collapse to chips that open an inline panel.
 */
@Component({
  selector: 'g-filter-bar',
  imports: [A11yModule, CdkConnectedOverlay, CdkOverlayOrigin, DateRangePipe, NgTemplateOutlet],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
})
export class FilterBar {
  private readonly filterState = inject(FilterState);
  private readonly injector = inject(Injector);
  protected readonly meta = inject(MetaService).require();
  protected readonly isDesktop = inject(Viewport).isDesktop;

  protected readonly filters = this.filterState.filters;
  protected readonly invalidText = computed(() =>
    this.filterState
      .invalid()
      .map((name) => FILTER_NAMES[name])
      .join(', '),
  );
  protected readonly zones = ZONES;
  protected readonly taskTypes = TASK_TYPES;
  protected readonly zoneLabels = ZONE_LABELS;
  protected readonly taskTypeLabels = TASK_TYPE_LABELS;

  protected readonly zoneText = computed(() => {
    const zone = this.filters().zone;
    return zone ? ZONE_LABELS[zone] : 'All zones';
  });
  protected readonly taskTypeText = computed(() => {
    const taskType = this.filters().taskType;
    return taskType ? TASK_TYPE_LABELS[taskType] : 'All task types';
  });

  /** Desktop: the date range dialog. */
  protected readonly datesOpen = signal(false);
  protected readonly datesPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  ];
  private readonly datesTrigger = viewChild<ElementRef<HTMLButtonElement>>('datesTrigger');

  /** Mobile: the inline filter panel and the chip that opened it. */
  protected readonly panelOpen = signal(false);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private opener: HTMLElement | null = null;

  protected toggleDates(): void {
    this.datesOpen.update((open) => !open);
  }

  protected closeDates(event?: MouseEvent): void {
    // A click on the trigger is "outside" the overlay too; let the trigger toggle instead.
    if (event && this.datesTrigger()?.nativeElement.contains(event.target as Node)) return;
    if (!this.datesOpen()) return;
    this.datesOpen.set(false);
    this.datesTrigger()?.nativeElement.focus();
  }

  protected onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeDates();
    }
  }

  protected openPanel(event: Event, focusId: string): void {
    this.opener = event.currentTarget as HTMLElement;
    this.panelOpen.set(true);
    // Wait for the panel to render, then move focus to the control the chip stands for.
    afterNextRender(
      () => this.panel()?.nativeElement.querySelector<HTMLElement>(focusId)?.focus(),
      {
        injector: this.injector,
      },
    );
  }

  protected closePanel(): void {
    this.panelOpen.set(false);
    this.opener?.focus();
    this.opener = null;
  }

  protected setDate(name: 'from' | 'to', input: HTMLInputElement): void {
    const value = input.value;
    const { from, to } = this.filters();
    if (value === '') {
      this.filterState.setFilters({
        [name]: name === 'from' ? this.meta.dataFrom : this.meta.dataTo,
      });
      return;
    }
    // Dates in YYYY-MM-DD form compare correctly as strings.
    const ok =
      isDateOnly(value) &&
      value >= this.meta.dataFrom &&
      value <= this.meta.dataTo &&
      (name === 'from' ? value <= to : value >= from);
    if (ok) {
      this.filterState.setFilters({ [name]: value });
    } else {
      input.value = name === 'from' ? from : to;
    }
  }

  protected resetDates(): void {
    this.filterState.setFilters({ from: this.meta.dataFrom, to: this.meta.dataTo });
  }

  protected setZone(value: string): void {
    this.filterState.setFilters({ zone: (value || null) as Zone | null });
  }

  protected setTaskType(value: string): void {
    this.filterState.setFilters({ taskType: (value || null) as TaskType | null });
  }
}
