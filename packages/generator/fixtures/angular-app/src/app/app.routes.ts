import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';

const requireAuth = () => true;

export const routes: Routes = [
  // An eager page, with an empty path.
  { path: '', component: HomeComponent },
  // Lazy pages: a default export, and a named one taken with .then().
  { path: 'login', loadComponent: () => import('./auth/login.component') },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent),
    canActivate: [requireAuth],
  },
  // A role written as route data.
  { path: 'admin', loadComponent: () => import('./admin/admin.component'), data: { roles: ['ADMIN'] } },
  // Lazy child routes, from a file of their own.
  { path: 'profile', loadChildren: () => import('./profile/profile.routes') },
  {
    path: 'editor',
    children: [
      { path: '', loadComponent: () => import('./editor/editor.component') },
      { path: ':slug', loadComponent: () => import('./editor/editor.component') },
    ],
  },
  // A redirect, and the app's 404.
  { path: 'old-settings', redirectTo: 'settings' },
  { path: '**', loadComponent: () => import('./not-found/not-found.component') },
];
