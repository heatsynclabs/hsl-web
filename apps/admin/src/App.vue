<template>
  <AppBar app-name="Admin">
    <template v-if="member">
      <Avatar :initials="initialsOf(member.name)" />
      <span>{{ member.name }}</span>
      <button class="app__signout" type="button" @click="signOut">Sign out</button>
    </template>
    <span v-else>Not signed in</span>
    <ThemeToggle />
  </AppBar>

  <nav v-if="links.length > 0" class="app__nav" aria-label="Admin screens">
    <RouterLink v-for="link in links" :key="link.name" class="app__tab" :to="{ name: link.name }">
      {{ link.label }}
    </RouterLink>
  </nav>

  <main class="app__body">
    <RouterView />
  </main>
</template>

<script setup lang="ts">
import { clearSession } from '@hsl/api-client'
import { AppBar, Avatar, ThemeToggle } from '@hsl/ui'
import { computed } from 'vue'
import { RouterLink, RouterView } from 'vue-router'

import { initialsOf } from './lib/format.ts'
import { holds, useSessionState } from './session.ts'

const state = useSessionState()
const member = computed(() => state.value.me?.member ?? null)

const links = computed(() => {
  const who = member.value
  if (who === null) return []

  const all = [
    { name: 'directory', label: 'Directory', needs: 'admin' as const },
    { name: 'audit', label: 'Audit', needs: 'admin' as const },
    { name: 'payments', label: 'Payments', needs: 'accountant' as const },
  ]
  return all.filter((link) => holds(who, link.needs))
})

/**
 * better-auth serves this endpoint, not the typed client. The method and path
 * were read from its 1.7.2 sources: dist/api/routes/sign-out.mjs declares
 * "/sign-out" as a POST, and services/api/src/auth.ts mounts it at /api/auth.
 */
async function signOut(): Promise<void> {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })
  clearSession()
  window.location.assign('/')
}
</script>

<style scoped>
.app__signout {
  min-height: var(--tap);
  border: 0;
  border-bottom: 1px solid var(--g-line);
  background: transparent;
  padding: 0;
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--accent-text);
  cursor: pointer;
}

.app__nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  border-bottom: 2px solid var(--g-line-hi);
  background: var(--g-plate);
  padding: 0 max(var(--space-5), var(--safe-l)) var(--space-3);
}

.app__tab {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  border: var(--bd-2);
  padding: 0 var(--space-4);
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-decoration: none;
  color: var(--g-ink);
}

.app__tab:hover {
  background: var(--hazard-dim);
}

.app__tab.router-link-active {
  background: var(--hazard);
  border-color: var(--tape-dark);
  color: var(--tape-dark);
  box-shadow: var(--shadow-sm);
}

.app__body {
  max-width: var(--container-xl);
  margin-inline: auto;
  padding: var(--space-5) max(var(--space-5), var(--safe-l)) var(--space-16);
}
</style>
