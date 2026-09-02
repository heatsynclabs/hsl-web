<template>
  <Card eyebrow="Access" :title="signedIn ? 'Not your screen' : 'Sign in first'">
    <p class="noaccess__body">{{ body }}</p>
    <Link href="/">Go to the members app</Link>
  </Card>
</template>

<script setup lang="ts">
import { Card, Link } from '@hsl/ui'
import { computed } from 'vue'

import { useSessionState } from '../session.ts'

/**
 * Where the router guard sends a navigation it would not open. The guard is a
 * courtesy: the API refuses the same request again and is the rule.
 */
const state = useSessionState()
const signedIn = computed(() => state.value.me !== null)

const body = computed(() => {
  if (state.value.error !== null) return state.value.error.message
  if (!signedIn.value) {
    return 'Nobody is signed in on this browser. Sign in on the members app and come back to this address.'
  }
  return 'This account is not an admin or an accountant, so these screens would only fill with refusals. Ask an admin whether your account should hold that.'
})
</script>

<style scoped>
.noaccess__body {
  margin: 0 0 var(--space-4);
  max-width: 60ch;
  line-height: var(--leading-normal);
}
</style>
