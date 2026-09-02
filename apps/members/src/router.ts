import type { NavigationGuardReturn, RouteLocationNormalizedGeneric, Router } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'

import { useSession } from '@hsl/api-client'

import DoorView from './views/DoorView.vue'
import ForgotPasswordView from './views/ForgotPasswordView.vue'
import ResetPasswordView from './views/ResetPasswordView.vue'
import OverviewView from './views/OverviewView.vue'
import SignInView from './views/SignInView.vue'

/** Routes an anonymous visitor is allowed to see. Everything else needs a session. */
const PUBLIC_ROUTES = new Set(['sign-in', 'forgot-password', 'reset-password'])

/**
 * A courtesy to the member, so nobody stares at a screen that was never going
 * to load. The API is the rule and refuses anything this lets through, per
 * section 5 of CONTRIBUTING.md. main.ts resolves the session before
 * router.isReady(), so reading it here costs no request.
 */
export function nextRoute(to: RouteLocationNormalizedGeneric): NavigationGuardReturn {
  const signedIn = useSession().state.status === 'signed-in'
  const isPublic = PUBLIC_ROUTES.has(String(to.name))

  if (!signedIn && !isPublic) return { name: 'sign-in', query: { next: to.fullPath } }
  if (signedIn && isPublic) return { name: 'overview' }
  return true
}

export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'overview', component: OverviewView },
      { path: '/door', name: 'door', component: DoorView },
      { path: '/sign-in', name: 'sign-in', component: SignInView },
      { path: '/forgot-password', name: 'forgot-password', component: ForgotPasswordView },
      { path: '/reset-password', name: 'reset-password', component: ResetPasswordView },
      { path: '/:rest(.*)', redirect: '/' },
    ],
  })

  router.beforeEach(nextRoute)
  return router
}
