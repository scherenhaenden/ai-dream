import 'zone.js';
import './styles.css';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

declare global {
  interface ImportMetaEnv { DEV: boolean }
}

async function start() {
  if (import.meta.env.DEV) await import('@angular/compiler');
  await bootstrapApplication(AppComponent, {
    providers: [provideRouter(routes), provideHttpClient()],
  });
}

void start().catch((error) => console.error(error));
