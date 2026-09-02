<template>
  <StepPage
    step="account"
    title="Your account"
    lede="This is the account you will sign in to the members app with. Nothing is sent to the lab until the last step."
  >
    <Field
      v-model="join.draft.name"
      label="Full name"
      autocomplete="name"
      :error="errors.name"
      required
    />
    <Field
      v-model="join.draft.email"
      label="Email"
      type="email"
      autocomplete="email"
      :error="errors.email"
      required
    />
    <Field
      v-model="join.draft.password"
      label="Password"
      type="password"
      autocomplete="new-password"
      :error="errors.password"
      required
    />
    <Note>At least 8 characters. It is the password for the members app.</Note>

    <div class="account__gap">
      <Field
        v-model="join.draft.phone"
        label="Phone"
        type="tel"
        autocomplete="tel"
        :error="errors.phone"
      />
      <Note>Optional. It goes on your member record and you can change it later.</Note>
    </div>

    <template #actions>
      <Button variant="primary" @click="carryOn">Continue</Button>
    </template>
  </StepPage>
</template>

<script setup lang="ts">
import { Button, Field, Note } from '@hsl/ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import StepPage from '../components/StepPage.vue'
import { errorsOn, join, leaveStep } from '../join-flow.ts'

const router = useRouter()
const errors = computed(() => errorsOn('account'))

function carryOn(): void {
  if (leaveStep('account')) void router.push({ name: 'emergency' })
}
</script>

<style scoped>
.account__gap {
  margin-top: var(--space-5);
}
</style>
