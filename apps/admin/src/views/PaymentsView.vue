<template>
  <Card eyebrow="Payments" title="Record a payment">
    <LoadState :pending="pending" :error="error" @retry="load">
      <PaymentForm
        :members="members"
        :saving="saving"
        :error="failure"
        :today="today"
        @record="record"
      />

      <Note v-if="receipt" class="pay__receipt">
        Recorded {{ receipt }}. It is on the member's record now, and the dues column in the
        directory reads from it. The change is in the audit log with your name.
      </Note>
    </LoadState>
  </Card>
</template>

<script setup lang="ts">
import { ApiError } from '@hsl/api-client'
import type { MemberDirectoryEntry, PostPaymentRequest } from '@hsl/schema'
import { Card, Note } from '@hsl/ui'
import { onMounted, ref } from 'vue'

import { api } from '../api.ts'
import LoadState from '../components/LoadState.vue'
import PaymentForm from '../components/PaymentForm.vue'
import { dayText, moneyText } from '../lib/format.ts'

const members = ref<MemberDirectoryEntry[]>([])
const pending = ref(true)
const saving = ref(false)
const error = ref<ApiError | null>(null)
const failure = ref<ApiError | null>(null)
const receipt = ref('')

const today = new Date().toISOString().slice(0, 10)

async function load(): Promise<void> {
  pending.value = true
  error.value = null

  try {
    members.value = (await api.members()).members
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    error.value = thrown
  } finally {
    pending.value = false
  }
}

function nameOf(userId: string): string {
  return members.value.find((member) => member.id === userId)?.name ?? userId
}

async function record(payment: PostPaymentRequest): Promise<void> {
  saving.value = true
  failure.value = null
  receipt.value = ''

  try {
    const answer = await api.recordPayment(payment)
    receipt.value = `${moneyText(answer.payment.amountCents)} for ${nameOf(answer.payment.userId)} on ${dayText(answer.payment.paidOn)}`
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    failure.value = thrown
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.pay__receipt {
  display: block;
  margin-top: var(--space-4);
  border-left: 3px solid var(--hazard);
  padding-left: var(--space-3);
}
</style>
