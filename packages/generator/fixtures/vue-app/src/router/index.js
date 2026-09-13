import { createRouter, createWebHistory } from 'vue-router';
import Home from '@/views/Home.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // An eager page, imported with its extension.
    { path: '/', name: 'home', component: Home },
    // Lazy pages, imported without one, through the Vite alias and relatively.
    { path: '/login', component: () => import('@/views/Login') },
    { path: '/settings', component: () => import('../views/Settings.vue'), meta: { requiresAuth: true } },
    // A role written as route meta.
    { path: '/admin', component: () => import('@/views/Admin'), meta: { roles: ['ADMIN'] } },
    {
      path: '/profile/:username',
      component: () => import('@/views/Profile'),
      children: [{ path: 'favorites', component: () => import('@/views/Favorites') }],
    },
    // A redirect: no page of its own, and not a problem.
    { path: '/old-settings', redirect: '/settings' },
    // The app's 404.
    { path: '/:pathMatch(.*)*', component: () => import('@/views/NotFound') },
  ],
});

export default router;
