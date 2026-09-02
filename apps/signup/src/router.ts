import { useSession } from '@hsl/api-client'
import type { RouteRecordRaw, Router, RouterHistory } from 'vue-router'
import { createRouter } from 'vue-router'

import { firstIncompleteStep, join, STEP_NAMES, type StepName } from './join-flow.ts'
import AccountView from './views/AccountView.vue'
import DoneView from './views/DoneView.vue'
import EmergencyView from './views/EmergencyView.vue'
import SignedInView from './views/SignedInView.vue'
import TierView from './views/TierView.vue'
import WaiverView from './views/WaiverView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    step?: StepName
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: { name: 'account' } },
  { path: '/account', name: 'account', component: AccountView, meta: { step: 'account' } },
  { path: '/emergency', name: 'emergency', component: EmergencyView, meta: { step: 'emergency' } },
  { path: '/waiver', name: 'waiver', component: WaiverView, meta: { step: 'waiver' } },
  { path: '/tier', name: 'tier', component: TierView, meta: { step: 'tier' } },
  { path: '/done', name: 'done', component: DoneView, meta: { step: 'done' } },
  { path: '/signed-in', name: 'signed-in', component: SignedInView },
  { path: '/:rest(.*)', redirect: { name: 'account' } },
]

function position(step: StepName): number {
  return STEP_NAMES.indexOf(step)
}

/**
 * A courtesy to the member, per section 5 of CONTRIBUTING.md. It keeps the five
 * screens in order and sends somebody who is already signed in to a note rather
 * than a second join form. The API is the rule: POST /api/signup refuses a
 * duplicate email and an unaccepted waiver whatever this lets through.
 *
 * The session is loaded once in main.ts before the router is ready, so this
 * reads a resolved value and never waits.
 */
export function joinGuard(to: { meta: { step?: StepName } }) {
  const step = to.meta.step
  if (step === undefined) return true

  // The application went through. Going back would only earn a 409.
  if (join.created !== null) return step === 'done' ? true : { name: 'done' }

  if (useSession().state.status === 'signed-in') return { name: 'signed-in' }

  const earned = firstIncompleteStep()
  if (position(step) > position(earned)) return { name: earned }

  return true
}

export function createJoinRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })
  router.beforeEach(joinGuard)
  return router
}
