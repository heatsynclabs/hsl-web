<template>
  <div class="sign-in">
    <LoginPanel title="Sign in" subtitle="to continue to Members">
      <form @submit.prevent="submit">
        <Field
          v-model="email"
          label="Email"
          type="email"
          autocomplete="username"
          required
        />
        <Field
          v-model="password"
          label="Password"
          type="password"
          autocomplete="current-password"
          required
        />

        <p v-if="problem" class="sign-in__problem" role="alert">{{ problem }}</p>

        <Button type="submit" variant="primary" block :disabled="working">
          {{ working ? 'Signing in' : 'Continue' }}
        </Button>

        <p class="sign-in__forgot">
          <RouterLink class="sign-in__link" to="/forgot-password">Forgot password</RouterLink>
        </p>

        <Note class="sign-in__note">
          The same password as the old members site. The hashes were imported as they were, so
          no password was reset.
        </Note>
      </form>
    </LoginPanel>
  </div>
</template>

<script setup lang="ts">
import { refreshSession } from '@hsl/api-client'
import { Button, Field, LoginPanel, Note } from '@hsl/ui'
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { useApi } from '../lib/api'
import { AuthError, signIn } from '../lib/auth'

const api = useApi()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const working = ref(false)
const problem = ref('')

/**
 * Only a path on this site, never a whole URL. Without the check, a link
 * carrying ?next=https://example.test would send a member somewhere else the
 * moment they signed in.
 */
function safeNext(value: unknown): string {
  const asked = typeof value === 'string' ? value : ''
  return asked.startsWith('/') && !asked.startsWith('//') ? asked : '/'
}

async function submit(): Promise<void> {
  working.value = true
  problem.value = ''

  try {
    await signIn(email.value, password.value)
    const session = await refreshSession(api)
    if (session.status !== 'signed-in') {
      problem.value =
        'Sign in worked but this app could not read your member record. Nothing was changed. Reload the page, and tell an admin if it happens again.'
      return
    }
    await router.push(safeNext(route.query['next']))
  } catch (error) {
    if (!(error instanceof AuthError)) throw error
    problem.value = error.message
  } finally {
    working.value = false
  }
}
</script>

<style scoped>
.sign-in {
  max-width: 420px;
  margin: 0 auto;
  border: var(--bd-2);
  background: var(--g-raised);
}

.sign-in__problem {
  margin: 0 0 var(--space-3);
  border: var(--bd-2);
  border-color: var(--fault);
  padding: var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}

.sign-in__forgot {
  margin: var(--space-3) 0 0;
  text-align: center;
}

.sign-in__link {
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-decoration: none;
  color: var(--accent-text);
  border-bottom: 1px solid var(--g-line);
}

.sign-in__note {
  margin-top: var(--space-3);
  text-align: center;
}
</style>
