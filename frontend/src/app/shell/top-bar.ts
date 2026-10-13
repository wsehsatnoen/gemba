import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FilterState } from '../core/filter-state';
import { environment } from '../../environments/environment';

/** The bar on every page: wordmark, nav, the "Synthetic data" badge, and outside links. */
@Component({
  selector: 'g-top-bar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.css',
})
export class TopBar {
  protected readonly linkParams = inject(FilterState).linkParams;
  protected readonly apiDocsUrl = environment.apiDocsUrl;
  protected readonly repoUrl = environment.repoUrl;
}
