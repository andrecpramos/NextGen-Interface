import { Routes } from '@angular/router';
import { ProfileComponent } from './profile.component';

const routes: Routes = [
  {
    path: ':username',
    component: ProfileComponent,
    children: [{ path: 'favorites', loadComponent: () => import('./favorites.component') }],
  },
];

export default routes;
