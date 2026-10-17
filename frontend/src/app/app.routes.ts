import { ActivatedRouteSnapshot, Routes } from '@angular/router';

// Each page is lazy-loaded, so the initial bundle holds only the shell.
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Overview · gemba',
    loadComponent: () => import('./features/overview/overview-page').then((m) => m.OverviewPage),
  },
  {
    path: 'partners',
    title: 'Partners · gemba',
    loadComponent: () =>
      import('./features/partners/partner-list-page').then((m) => m.PartnerListPage),
  },
  {
    path: 'partners/:partnerId',
    title: (route: ActivatedRouteSnapshot) => `${route.paramMap.get('partnerId')} · gemba`,
    loadComponent: () =>
      import('./features/partners/partner-detail-page').then((m) => m.PartnerDetailPage),
  },
  {
    path: 'tasks',
    title: 'Tasks · gemba',
    loadComponent: () => import('./features/tasks/tasks-page').then((m) => m.TasksPage),
  },
  { path: '**', redirectTo: '' },
];
