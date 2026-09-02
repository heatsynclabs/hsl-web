<template>
  <div>
    <p class="queue__how">
      Hold the card to the reader by the door. The controller refuses a card it does not know and
      writes it to its log, the door service reads that log and puts the number back together, and
      the card appears in the list below. Choose Assign on its row and pick who it belongs to.
    </p>

    <Note v-if="stale" class="queue__stale">
      The door service has not reported recently, so this list may be behind. A card held to the
      reader in the last few minutes may not be in it yet.
    </Note>

    <div class="queue__table">
      <DataTable :columns="COLUMNS" :rows="rows" :empty-text="EMPTY">
        <template #cell-outcome="{ row }">
          <Pill :state="outcomePill(row['outcomeValue'])">{{ row['outcome'] }}</Pill>
        </template>
        <template #cell-action="{ row }">
          <Button :disabled="disabled" @click="emit('pick', String(row['cardNumber']))">
            Assign
          </Button>
        </template>
      </DataTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UnknownCard } from '@hsl/schema'
import type { DataColumn, DataRow } from '@hsl/ui'
import { Button, DataTable, Note, Pill } from '@hsl/ui'
import { computed } from 'vue'

import { outcomePill, outcomeText } from '../lib/door.ts'
import { whenText } from '../lib/format.ts'

/**
 * The enrolment queue: cards held to a reader in the last 24 hours that no card
 * row claims. It replaces reading the raw door log and working the tag out by
 * hand from its two halves.
 */
interface Props {
  cards: UnknownCard[]
  /** True when the door service has not reported recently enough to trust the list. */
  stale: boolean
  /** True while an assignment is in flight, so a second one cannot be started. */
  disabled: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ pick: [cardNumber: string] }>()

const EMPTY =
  'No unknown card has been read in the last 24 hours. Hold the card to the reader by the door and it shows up here.'

const COLUMNS: DataColumn[] = [
  { key: 'cardNumber', label: 'Card number', mono: true },
  { key: 'outcome', label: 'What the reader did' },
  { key: 'timesSeen', label: 'Times', mono: true },
  { key: 'lastSeen', label: 'Last seen' },
  { key: 'action', label: '' },
]

const rows = computed<DataRow[]>(() =>
  props.cards.map((card) => ({
    cardNumber: card.cardNumber,
    outcome: outcomeText(card.outcome),
    outcomeValue: card.outcome,
    timesSeen: String(card.timesSeen),
    lastSeen: whenText(card.lastSeen),
    action: '',
  })),
)
</script>

<style scoped>
.queue__how {
  margin: 0 0 var(--space-3);
  font-size: 14px;
  line-height: var(--leading-normal);
  color: var(--g-ink);
}

.queue__stale {
  display: block;
  margin-bottom: var(--space-3);
  border-left: 3px solid var(--fault);
  padding-left: var(--space-3);
}

.queue__table {
  overflow-x: auto;
}
</style>
