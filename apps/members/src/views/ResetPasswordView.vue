<template>
  <LoginPanel title="Choose a password" :subtitle="subtitle">
    <p v-if="linkProblem" class="reset__problem">
      {{ linkProblem }}
    </p>

    <template v-else-if="done">
      <p class="reset__done">
        Your password is set and every other browser has been signed out. Sign in with it now.
      </p>
      <Button @click="goToSignIn">Sign in</Button>
    </template>

    <form v-else @submit.prevent="submit">
      <Field
        v-model="password"
        label="New password"
        type="password"
        autocomplete="new-password"
        :error="refusal ?? undefined"
      />
      <Note>At least eight characters. It replaces whatever the account had before.</Note>
      <Button type="submit" :disabled="working">
        {{ working ? 'Setting it' : 'Set password' }}
      </Button>
    </form>
  </LoginPanel>
</template>

<script setup lang="ts">
import { Button, Field, LoginPanel, Note } from '@hsl/ui'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { resetPassword } from '../lib/auth'

/**
 * The second half of a password reset.
 *
 * better-auth checks the token in the emailed link and then sends the member
 * here with it on the query string, or with an error there instead when the
 * link has expired or been used. Without this screen the link landed nowhere,
 * and the 31 imported members who have never had a password had no way in at
 * all.
 */
const route = useRoute()
const router = useRouter()

const password = ref('')
const refusal = ref<string | null>(null)
const working = ref(false)
const done = ref(false)

const token = computed(() => {
  const value = route.query['token']
  return typeof value === 'string' && value !== '' ? value : null
})

const linkProblem = computed(() => {
  if (route.query['error'] !== undefined || token.value === null) {
    return 'That reset link has expired or has already been used. Ask for a new one and open the newest email.'
  }
  return null
})

const subtitle = computed(() =>
  linkProblem.value === null ? 'for your HeatSync Labs account' : '',
)

async function submit(): Promise<void> {
  if (token.value === null || working.value) return

  working.value = true
  refusal.value = null
  try {
    await resetPassword(token.value, password.value)
    done.value = true
  } catch (error) {
    refusal.value = error instanceof Error ? error.message : String(error)
  } finally {
    working.value = false
  }
}

async function goToSignIn(): Promise<void> {
  await router.push({ name: 'sign-in' })
}
</script>

<style scoped>
.reset__problem,
.reset__done {
  margin: 0 0 var(--space-4);
  color: var(--g-ink-2);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.reset__problem {
  color: var(--ink-err);
}
</style>
