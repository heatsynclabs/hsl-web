<template>
  <div class="forgot">
    <LoginPanel title="Reset your password" subtitle="Members">
      <form @submit.prevent="submit">
        <Field v-model="email" label="Email" type="email" autocomplete="username" required />

        <p v-if="problem" class="forgot__problem" role="alert">{{ problem }}</p>
        <p v-else-if="answer" class="forgot__answer" role="status">{{ answer }}</p>

        <Button type="submit" variant="primary" block :disabled="working">
          {{ working ? 'Sending' : 'Send a reset link' }}
        </Button>

        <p class="forgot__back">
          <RouterLink class="forgot__link" to="/sign-in">Back to sign in</RouterLink>
        </p>

        <Note class="forgot__note">
          The API sends the mail. If this comes back refused, mail is not configured on the server
          yet and an admin needs to hear about it.
        </Note>
      </form>
    </LoginPanel>
  </div>
</template>

<script setup lang="ts">
import { Button, Field, LoginPanel, Note } from '@hsl/ui'
import { ref } from 'vue'
import { RouterLink } from 'vue-router'

import { AuthError, requestPasswordReset } from '../lib/auth'

const email = ref('')
const working = ref(false)
const problem = ref('')
const answer = ref('')

async function submit(): Promise<void> {
  working.value = true
  problem.value = ''
  answer.value = ''

  try {
    answer.value = await requestPasswordReset(email.value)
  } catch (error) {
    if (!(error instanceof AuthError)) throw error
    problem.value = error.message
  } finally {
    working.value = false
  }
}
</script>

<style scoped>
.forgot {
  max-width: 420px;
  margin: 0 auto;
  border: var(--bd-2);
  background: var(--g-raised);
}

.forgot__problem,
.forgot__answer {
  margin: 0 0 var(--space-3);
  border: var(--bd-2);
  padding: var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
}

.forgot__problem {
  border-color: var(--fault);
  color: var(--ink-err);
}

.forgot__answer {
  border-color: var(--g-line-hi);
  color: var(--g-ink);
}

.forgot__back {
  margin: var(--space-3) 0 0;
  text-align: center;
}

.forgot__link {
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-decoration: none;
  color: var(--accent-text);
  border-bottom: 1px solid var(--g-line);
}

.forgot__note {
  margin-top: var(--space-3);
  text-align: center;
}
</style>
