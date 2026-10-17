import { httpResource } from '@angular/common/http';
import { Service } from '@angular/core';
import { apiRequest } from './request';
import type { TaskDetail, TaskPage, TaskQuery } from './types';

/** Task endpoints. See AnalyticsApi for how the resources refetch. */
@Service()
export class TasksApi {
  list(query: () => TaskQuery | undefined) {
    return httpResource<TaskPage>(() => apiRequest('/api/tasks', query()));
  }

  /** `taskId` returning null means no task is open, so nothing is fetched. */
  task(taskId: () => number | null | undefined) {
    return httpResource<TaskDetail>(() => {
      const id = taskId();
      return id == null ? undefined : apiRequest(`/api/tasks/${id}`, {});
    });
  }
}
