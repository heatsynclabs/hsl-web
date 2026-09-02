<template>
  <StepPage
    step="emergency"
    title="Emergency contact"
    lede="If you are hurt in the shop, this is the person the lab calls."
  >
    <Field
      v-model="join.draft.emergencyName"
      label="Contact name"
      autocomplete="off"
      :error="errors.emergencyName"
    />
    <Field
      v-model="join.draft.emergencyPhone"
      label="Contact phone"
      type="tel"
      autocomplete="off"
      :error="errors.emergencyPhone"
    />
    <Note>
      Both are optional here. You can add them or change them later from the members app.
    </Note>

    <template #actions>
      <Button @click="goBack">Back</Button>
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
const errors = computed(() => errorsOn('emergency'))

function goBack(): void {
  void router.push({ name: 'account' })
}

function carryOn(): void {
  if (leaveStep('emergency')) void router.push({ name: 'waiver' })
}
</script>
