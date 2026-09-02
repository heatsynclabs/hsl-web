<template>
  <form @submit.prevent="submit">
    <Field v-model="search" label="Find the member" autocomplete="off" />

    <label class="pay__field">
      <span class="pay__label">Member</span>
      <select v-model="userId" class="pay__input">
        <option value="">Pick a member</option>
        <option v-for="option in shown" :key="option.id" :value="option.id">
          {{ option.name }}
        </option>
      </select>
    </label>
    <Note v-if="matches.length > shown.length">
      {{ matches.length }} members match. The list shows the first {{ shown.length }}, so type
      more of the name.
    </Note>

    <Field v-model="amount" label="Amount, dollars" :error="amountError" autocomplete="off" />

    <label class="pay__field">
      <span class="pay__label">Paid on</span>
      <input v-model="paidOn" class="pay__input" type="date" :max="today">
    </label>

    <Field v-model="note" label="Note, optional" autocomplete="off" />

    <p v-if="error" class="pay__error" role="alert">{{ error.problem ?? error.message }}</p>

    <Button variant="primary" type="submit" :disabled="saving || userId === ''">
      {{ saving ? 'Recording' : 'Record payment' }}
    </Button>
  </form>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import type { MemberDirectoryEntry, PostPaymentRequest } from '@hsl/schema'
import { Button, Field, Note } from '@hsl/ui'
import { computed, ref } from 'vue'

import { centsFromInput } from '../lib/format.ts'

/**
 * An accountant recording money that arrived through the offline rails the lab
 * already has. There is no payment integration behind this, and the record is
 * what makes the directory's dues column true.
 */
interface Props {
  members: MemberDirectoryEntry[]
  saving: boolean
  error: ApiError | null
  today: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ record: [payment: PostPaymentRequest] }>()

// A thousand names in one select is unusable, so the list is the search result.
const SHOWN_AT_ONCE = 50

const search = ref('')
const userId = ref('')
const amount = ref('')
const note = ref('')
const paidOn = ref(props.today)
const amountError = ref('')

const matches = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (needle === '') return props.members

  return props.members.filter((member) => member.name.toLowerCase().includes(needle))
})

const shown = computed(() => matches.value.slice(0, SHOWN_AT_ONCE))

function submit(): void {
  const amountCents = centsFromInput(amount.value)

  if (amountCents === null) {
    amountError.value =
      'An amount is dollars and cents, like 50 or 50.00. Nothing was recorded. Type the amount again.'
    return
  }

  amountError.value = ''
  const trimmed = note.value.trim()
  const payment: PostPaymentRequest = { userId: userId.value, amountCents, paidOn: paidOn.value }
  emit('record', trimmed === '' ? payment : { ...payment, note: trimmed })
}
</script>

<style scoped>
.pay__field {
  display: block;
  margin-bottom: var(--space-3);
}

.pay__label {
  display: block;
  margin-bottom: 5px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.pay__input {
  width: 100%;
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-plate);
  padding: 10px 12px;
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--g-ink);
}

.pay__error {
  margin: 0 0 var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
