<template>
  <div class="app">
    <AppBar v-if="member" app-name="Members">
      <Avatar :initials="initials" />
      <span class="app__who">{{ member.name }}</span>
      <button class="app__signout" type="button" @click="leave">Sign out</button>
    </AppBar>

    <nav v-if="member" class="app__nav" aria-label="Members">
      <RouterLink class="app__tab" to="/">Profile</RouterLink>
      <RouterLink class="app__tab" to="/door">Door</RouterLink>
    </nav>

    <main class="app__main">
      <p v-if="crashed" class="app__crashed">
        This screen stopped part way through and nothing was changed. Reload the page. If it keeps
        happening, tell an admin what you were doing.
      </p>
      <RouterView v-else v-slot="{ Component }">
        <Suspense timeout="0">
          <component :is="Component" />
          <template #fallback>
            <p class="app__loading">Loading</p>
          </template>
        </Suspense>
      </RouterView>
    </main>
  </div>
</template>

<script setup lang="ts">
import { clearSession } from '@hsl/api-client'
import { AppBar, Avatar } from '@hsl/ui'
import { computed, onErrorCaptured, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'

import { signOut } from './lib/auth'
import { useMemberSession } from './lib/session'

const router = useRouter()
const session = useMemberSession()
const member = computed(() => session.value.me?.member ?? null)
const crashed = ref(false)

const initials = computed(() => {
  const words = (member.value?.name ?? '').split(' ').filter((word) => word !== '')
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('')
})

// A view that throws inside Suspense leaves a blank page, which is the one
// outcome worse than an error message.
onErrorCaptured((error) => {
  console.error('[members] a screen failed', error)
  crashed.value = true
  return false
})

async function leave(): Promise<void> {
  try {
    await signOut()
  } finally {
    // The cookie may already be gone. Either way this browser stops showing a
    // member who is no longer signed in.
    clearSession()
    await router.push({ name: 'sign-in' })
  }
}
</script>

<style scoped>
.app {
  min-height: 100vh;
  background: var(--g-bg);
  color: var(--g-ink);
}

.app__who {
  white-space: nowrap;
}

.app__signout {
  min-height: var(--tap);
  border: 0;
  background: transparent;
  padding: 0;
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--accent-text);
  cursor: pointer;
  border-bottom: 1px solid var(--g-line);
}

.app__nav {
  display: flex;
  gap: var(--space-5);
  border-bottom: 2px solid var(--g-line);
  padding: 0 max(var(--space-5), var(--safe-l));
  background: var(--g-plate);
}

.app__tab {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  border-bottom: 2px solid transparent;
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-decoration: none;
  color: var(--g-ink-2);
}

.app__tab.router-link-exact-active {
  border-bottom-color: var(--hazard);
  color: var(--accent-text);
}

.app__main {
  padding: var(--space-5);
  padding-left: max(var(--space-5), var(--safe-l));
  padding-right: max(var(--space-5), var(--safe-r));
  padding-bottom: max(var(--space-5), var(--safe-b));
}

.app__loading,
.app__crashed {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 11px;
  line-height: var(--leading-normal);
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.app__crashed {
  border: var(--bd-2);
  border-color: var(--fault);
  padding: var(--space-4);
  text-transform: none;
  letter-spacing: var(--tracking-wide);
  color: var(--ink-err);
}
</style>
