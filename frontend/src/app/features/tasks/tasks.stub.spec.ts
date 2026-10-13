// Interface checks for the Phase 1 stubs. Agent B replaces these with real tests.
import { TestBed } from '@angular/core/testing';
import { TaskPanel } from './task-panel';
import { TaskTable } from './task-table';

describe('task stubs', () => {
  it('task table takes a query and a selection and emits taskSelect', async () => {
    const fixture = TestBed.createComponent(TaskTable);
    fixture.componentRef.setInput('query', { partnerId: 'SIMUSR0142', page: 0 });
    fixture.componentRef.setInput('selectedTaskId', null);
    const selected: number[] = [];
    fixture.componentInstance.taskSelect.subscribe((id) => selected.push(id));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    expect(selected).toEqual([48213]);
  });

  it('task panel takes a task ID and emits closed', async () => {
    const fixture = TestBed.createComponent(TaskPanel);
    fixture.componentRef.setInput('taskId', 48213);
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    expect(closed).toBe(true);
  });
});
