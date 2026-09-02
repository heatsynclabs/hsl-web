<template>
  <div>
    <div class="cards__table">
      <DataTable
        :columns="COLUMNS"
        :rows="tableRows"
        empty-text="No card on this member. Assign one below."
      >
        <template #cell-state="{ row }">
          <Pill :state="row['active'] === 'yes' ? 'on' : 'off'">{{ row['state'] }}</Pill>
        </template>
        <template #cell-action="{ row }">
          <Button
            v-if="row['active'] === 'yes'"
            :disabled="saving"
            @click="emit('deactivate', Number(row['slotValue']))"
          >
            Deactivate
          </Button>
        </template>
      </DataTable>
    </div>

    <form class="cards__form" @submit.prevent="submit">
      <Field
        v-model="typed"
        label="Card number, hex"
        :error="numberError"
        autocomplete="off"
      />
      <Field v-model="label" label="Label, optional" autocomplete="off" />
      <Note>
        Short numbers are padded to eight characters, the width the controller writes. The API
        picks the lowest free slot under 200, so no slot is typed here and none is ever renumbered.
      </Note>
      <Button variant="primary" type="submit" :disabled="saving">
        {{ saving ? 'Assigning' : 'Assign card' }}
      </Button>
    </form>

    <Note v-if="assignedSlot !== null" class="cards__assigned">
      Card written to slot {{ slotText(assignedSlot) }}. The door service writes the controller on
      its next reconcile pass, so the card opens the door then rather than the moment you press
      the button.
    </Note>

    <p v-if="error" class="cards__error" role="alert">{{ refusalText }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import type { CardRecord } from '@hsl/schema'
import type { DataColumn, DataRow } from '@hsl/ui'
import { Button, DataTable, Field, Note, Pill } from '@hsl/ui'
import { computed, ref } from 'vue'

import { padCardNumber, slotText } from '../lib/format.ts'

/**
 * The cards a member holds, and the one flow that hands out a door key. The
 * slot is an EEPROM address on the controller, so it is shown exactly as stored
 * and nothing here can choose or change it.
 */
interface Props {
  cards: CardRecord[]
  saving: boolean
  assignedSlot: number | null
  error: ApiError | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  assign: [request: { cardNumber: string; label?: string }]
  deactivate: [slot: number]
}>()

const COLUMNS: DataColumn[] = [
  { key: 'slot', label: 'Slot', mono: true },
  { key: 'number', label: 'Card number', mono: true },
  { key: 'label', label: 'Label' },
  { key: 'state', label: 'State' },
  { key: 'action', label: '' },
]

const typed = ref('')
const label = ref('')
const numberError = ref('')

const tableRows = computed<DataRow[]>(() =>
  props.cards.map((card) => ({
    slot: slotText(card.slot),
    slotValue: String(card.slot),
    number: card.cardNumber,
    label: card.label ?? '',
    state: card.active ? 'Active' : 'Deactivated',
    active: card.active ? 'yes' : 'no',
    action: '',
  })),
)

const refusalText = computed(() => props.error?.problem ?? props.error?.message ?? '')

function submit(): void {
  const raw = typed.value.trim().toUpperCase()

  if (!/^[0-9A-F]{1,8}$/.test(raw)) {
    numberError.value =
      'A card number is up to eight hex characters, 0 to 9 and A to F. Nothing was sent. Read the number off the fob and type it again.'
    return
  }

  numberError.value = ''
  const cardNumber = padCardNumber(raw)
  const trimmed = label.value.trim()
  emit('assign', trimmed === '' ? { cardNumber } : { cardNumber, label: trimmed })
}
</script>

<style scoped>
.cards__table {
  overflow-x: auto;
}

.cards__form {
  margin-top: var(--space-5);
  border-top: 1px solid var(--g-line);
  padding-top: var(--space-4);
}

.cards__assigned {
  display: block;
  margin-top: var(--space-3);
}

.cards__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
