import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: 'chat', loadComponent: () => import('./pages/chat.page').then(m => m.ChatPage) },
  { path: 'models', loadComponent: () => import('./pages/models.page').then(m => m.ModelsPage) },
  { path: 'hub', loadComponent: () => import('./pages/hub.page').then(m => m.HubPage) },
  { path: 'hardware', loadComponent: () => import('./pages/hardware.page').then(m => m.HardwarePage) },
  { path: 'runtime', loadComponent: () => import('./pages/runtime.page').then(m => m.RuntimePage) },
  { path: 'downloads', loadComponent: () => import('./pages/downloads.page').then(m => m.DownloadsPage) },
  { path: 'settings', loadComponent: () => import('./pages/settings.page').then(m => m.SettingsPage) },
  { path: '**', redirectTo: 'chat' },
];
