import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TasksApi } from '../../core/api/tasks-api';
import { DurationPipe, FacilityDatePipe, FacilityTimePipe } from '../../core/format';
import {
  MOVE_ROLE_LABELS,
  NO_PARTNER_SOURCE_LABEL,
  PARTNER_SOURCE_LABELS,
  TASK_TYPE_LABELS,
  ZONE_LABELS,
} from '../../core/labels';
import { isNotFound, toProblem } from '../../core/problem';
import { Viewport } from '../../core/viewport';
import { State } from '../../shared/ui/state';
import { signedQuantity } from './signed-quantity';

/**
 * The task panel: how one task was paired from the moves on its bin.
 * A column beside the list on desktop and a full-screen view (with a focus trap) under
 * 1024 px. Esc, ×, or the back arrow emits `closed`; the page then removes `task` from the URL.
 * Focus moves to the heading whenever a task opens.
 */
@Component({
  selector: 'g-task-panel',
  imports: [CdkTrapFocus, State, DurationPipe, FacilityDatePipe, FacilityTimePipe],
  templateUrl: './task-panel.html',
  styleUrl: './task-panel.css',
  host: {
    '[class.fullscreen]': '!isDesktop()',
    '(document:keydown.escape)': 'onEscape($event)',
  },
})
export class TaskPanel {
  readonly taskId = input.required<number>();
  readonly closed = output<void>();

  protected readonly isDesktop = inject(Viewport).isDesktop;
  protected readonly resource = inject(TasksApi).task(() => this.taskId());

  protected readonly task = computed(() =>
    this.resource.hasValue() ? this.resource.value() : null,
  );
  protected readonly notFound = computed(() => isNotFound(this.resource.error()));
  protected readonly problem = computed(() => toProblem(this.resource.error()));
  protected readonly partnerSourceLabel = computed(() => {
    const source = this.task()?.partnerSource;
    return source ? PARTNER_SOURCE_LABELS[source] : NO_PARTNER_SOURCE_LABEL;
  });

  protected readonly zoneLabels = ZONE_LABELS;
  protected readonly taskTypeLabels = TASK_TYPE_LABELS;
  protected readonly roleLabels = MOVE_ROLE_LABELS;
  protected readonly signedQuantity = signedQuantity;
  protected readonly skeletonMoves = [0, 1, 2, 3];

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  constructor() {
    // Runs after the panel renders, and again whenever another task opens in it.
    afterRenderEffect(() => {
      this.taskId();
      this.heading().nativeElement.focus();
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onEscape(event: Event): void {
    // Something else (an open menu, for example) already handled this Esc.
    if (event.defaultPrevented) return;
    this.close();
  }
}
