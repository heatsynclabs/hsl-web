import { useSession } from '@hsl/api-client'
import type { Router, RouterHistory } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import type { Privilege } from './session.ts'
import { holds } from './session.ts'
import NoAccessView from './views/NoAccessView.vue'

/** Caddy strips /admin before the files are read, so the router puts it back. */
export const ROUTER_BASE = '/admin/'

declare module 'vue-router' {
  interface RouteMeta {
    needs?: Privilege
  }
}

const routes = [
  { path: '/', redirect: { name: 'directory' } },
  {
    path: '/directory',
    name: 'directory',
    component: () => import('./views/DirectoryView.vue'),
    meta: { needs: 'admin' as const },
  },
  {
    path: '/members/:id',
    name: 'member',
    component: () => import('./views/MemberView.vue'),
    meta: { needs: 'admin' as const },
  },
  {
    path: '/door',
    name: 'door',
    component: () => import('./views/DoorView.vue'),
    meta: { needs: 'admin' as const },
  },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('./views/AuditView.vue'),
    meta: { needs: 'admin' as const },
  },
  {
    path: '/payments',
    name: 'payments',
    component: () => import('./views/PaymentsView.vue'),
    meta: { needs: 'accountant' as const },
  },
  // Eager, because it is where a refused navigation lands and a failed chunk
  // fetch would leave a refusal with nothing to show.
  { path: '/no-access', name: 'no-access', component: NoAccessView },
  { path: '/:rest(.*)', name: 'not-found', component: () => import('./views/NotFoundView.vue') },
]

export function createAdminRouter(history: RouterHistory = createWebHistory(ROUTER_BASE)): Router {
  const router = createRouter({ history, routes })

  /**
   * A courtesy to the member, not the rule. It saves an admin from opening a
   * screen that would only fill with refusals, and it is worth nothing on its
   * own: the API checks every one of these routes again and is the only thing
   * that decides. See section 5 of CONTRIBUTING.md.
   */
  router.beforeEach((to) => {
    const needed = to.meta.needs
    if (needed === undefined) return true

    const member = useSession().member
    if (member !== null && holds(member, needed)) return true

    return { name: 'no-access', query: { from: to.fullPath }, replace: true }
  })

  return router
}
