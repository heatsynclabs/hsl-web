<template>
  <div>
    <KeyValue :rows="countRows" />

    <Note class="card-table__what">
      This is what the controller should be holding after the next pass. The door service writes
      the difference, so a row here is a card the reader will accept once it has been pushed.
    </Note>

    <Note v-if="unreadable.length > 0" class="card-table__flag">
      Slot {{ slotListText(unreadable) }} is outside the range the reader scans. The firmware
      accepts a write up there and its read loop never reaches it, so that card does not open the
      door. Deactivate it and assign the card again to get a slot the reader can see.
    </Note>

    <Note v-if="unreconciled.length > 0" class="card-table__flag">
      Slot {{ slotListText(unreconciled) }} will be cleared on the next pass, because the card is
      deactivated or the member it belongs to no longer has card access.
    </Note>

    <div class="card-table__table">
      <DataTable :columns="COLUMNS" :rows="rows" :empty-text="EMPTY">
        <template #cell-slot="{ row }">
          <span class="card-table__slot">{{ row['slot'] }}</span>
          <Pill v-if="row['readable'] === 'no'" state="off">Reader cannot see it</Pill>
        </template>
        <template #cell-state="{ row }">
          <Pill :state="row['active'] === 'yes' ? 'on' : 'off'">{{ row['state'] }}</Pill>
        </template>
        <template #cell-nextPass="{ row }">
          <Pill v-if="row['reconciled'] === 'no'" state="off">Will be cleared</Pill>
          <span v-else>Kept</span>
        </template>
        <template #cell-action="{ row }">
          <Button
            v-if="row['active'] === 'yes'"
            :disabled="busySlot !== null"
            @click="emit('deactivate', Number(row['slotValue']))"
          >
            {{ busySlot === Number(row['slotValue']) ? 'Saving' : 'Deactivate' }}
          </Button>
        </template>
      </DataTable>
    </div>

    <p v-if="error" class="card-table__error" role="alert">{{ error.problem ?? error.message }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import type { CardTableViewResponse } from '@hsl/schema'
import type { DataColumn, DataRow, KeyValueRow } from '@hsl/ui'
import { Button, DataTable, KeyValue, Note, Pill } from '@hsl/ui'
import { computed } from 'vue'

import { slotIsReadable, slotListText, unreadableSlots, unreconciledSlots } from '../lib/door.ts'
import { slotText } from '../lib/format.ts'

/**
 * The card table the door service reconciles the controller to. A slot is an
 * EEPROM address, so it is shown exactly as stored and nothing here renumbers
 * one.
 */
interface Props {
  view: CardTableViewResponse
  /** The slot whose deactivation is in flight, so its own button says Saving. */
  busySlot: number | null
  error: ApiError | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ deactivate: [slot: number] }>()

const EMPTY = 'No card is in the table. Enrol one above and it lands in the lowest free slot.'

const COLUMNS: DataColumn[] = [
  { key: 'slot', label: 'Slot', mono: true },
  { key: 'cardNumber', label: 'Card number', mono: true },
  { key: 'holder', label: 'Who holds it' },
  { key: 'state', label: 'State' },
  { key: 'nextPass', label: 'Next pass' },
  { key: 'action', label: '' },
]

const unreadable = computed(() => unreadableSlots(props.view.slots))
const unreconciled = computed(() => unreconciledSlots(props.view.slots))

const countRows = computed<KeyValueRow[]>(() => [
  { label: 'Slots used', value: String(props.view.usedSlots) },
  { label: 'Slots free', value: String(props.view.freeSlots) },
  {
    label: 'Next free slot',
    value:
      props.view.nextFreeSlot === null
        ? 'None. Every slot the reader can scan holds a card.'
        : slotText(props.view.nextFreeSlot),
  },
])

const rows = computed<DataRow[]>(() =>
  props.view.slots.map((entry) => ({
    slot: slotText(entry.slot),
    slotValue: String(entry.slot),
    readable: slotIsReadable(entry.slot) ? 'yes' : 'no',
    cardNumber: entry.cardNumber,
    holder: entry.memberName ?? entry.memberId ?? 'nobody on record',
    state: entry.active ? 'Active' : 'Deactivated',
    active: entry.active ? 'yes' : 'no',
    reconciled: entry.reconciled ? 'yes' : 'no',
    nextPass: '',
    action: '',
  })),
)
</script>

<style scoped>
.card-table__what,
.card-table__flag {
  display: block;
  margin-top: var(--space-3);
}

.card-table__flag {
  border-left: 3px solid var(--fault);
  padding-left: var(--space-3);
}

.card-table__table {
  overflow-x: auto;
  margin-top: var(--space-4);
}

.card-table__slot {
  margin-right: var(--space-2);
}

.card-table__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
