import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MetaService } from './core/meta.service';
import { State } from './shared/ui/state';
import { TopBar } from './shell/top-bar';

@Component({
  selector: 'g-root',
  imports: [RouterOutlet, State, TopBar],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly metaService = inject(MetaService);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  protected skipToContent(): void {
    this.main().nativeElement.focus();
  }
}
