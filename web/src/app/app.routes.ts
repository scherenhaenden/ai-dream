import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: 'chat', loadComponent: () => import('./pages/chat.page').then(m => m.ChatPage) },
  { path: 'agent', loadComponent: () => import('./pages/agent.page').then(m => m.AgentPage) },
  { path: 'local-api', loadComponent: () => import('./pages/local-api.page').then(m => m.LocalApiPage) },
  { path: 'tools-permissions', loadComponent: () => import('./pages/tools-permissions.page').then(m => m.ToolsPermissionsPage) },
  { path: 'knowledge', loadComponent: () => import('./pages/knowledge.page').then(m => m.KnowledgePage) },
  { path: 'logs', loadComponent: () => import('./pages/logs.page').then(m => m.LogsPage) },
  { path: 'models', loadComponent: () => import('./pages/model-studio.page').then(m => m.ModelStudioPage) },
  { path: 'hub', loadComponent: () => import('./pages/hub.page').then(m => m.HubPage) },
  { path: 'hardware', loadComponent: () => import('./pages/hardware.page').then(m => m.HardwarePage) },
  { path: 'runtime', loadComponent: () => import('./pages/runtime.page').then(m => m.RuntimePage) },
  { path: 'load-model', loadComponent: () => import('./pages/runtime.page').then(m => m.RuntimePage) },
  { path: 'downloads', loadComponent: () => import('./pages/downloads.page').then(m => m.DownloadsPage) },
  { path: 'settings', loadComponent: () => import('./pages/settings.page').then(m => m.SettingsPage) },
  { path: '**', redirectTo: 'chat' },
];
