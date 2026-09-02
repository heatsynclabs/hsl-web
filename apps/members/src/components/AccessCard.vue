<template>
  <Card eyebrow="Door access" title="My cards">
    <div class="access-card__scroll">
      <DataTable
        :columns="COLUMNS"
        :rows="rows"
        empty-text="No card on your record yet. Ask an admin to assign one."
      >
        <template #cell-state="{ row }">
          <Pill :state="row['state'] === ACTIVE ? 'on' : 'off'">{{ row['state'] }}</Pill>
        </template>
      </DataTable>
    </div>
    <Note class="access-card__note">
      Lost a card? Ask an admin. One admin can assign or deactivate a card on their own, and every
      change is written to the audit log with who made it and when.
    </Note>
  </Card>
</template>

<script setup lang="ts">
import type { CardRecord } from '@hsl/schema'
import type { DataColumn, DataRow } from '@hsl/ui'
import { Card, DataTable, Note, Pill } from '@hsl/ui'
import { computed } from 'vue'

interface Props {
  cards: CardRecord[]
}

const props = defineProps<Props>()

const ACTIVE = 'Active'

// The controller takes a slot as three digits in its m<slot:3> parameter, and
// the legacy screens printed it the same way. The value itself is never changed.
const SLOT_DIGITS = 3

const COLUMNS: DataColumn[] = [
  { key: 'slot', label: 'Slot', mono: true },
  { key: 'tag', label: 'Tag', mono: true },
  { key: 'state', label: 'State' },
]

const rows = computed<DataRow[]>(() =>
  props.cards.map((card) => ({
    slot: String(card.slot).padStart(SLOT_DIGITS, '0'),
    tag: card.cardNumber,
    state: card.active ? ACTIVE : 'Deactivated',
  })),
)
</script>

<style scoped>
/* A narrow screen scrolls the table inside the card rather than sliding the
   whole page sideways. */
.access-card__scroll {
  overflow-x: auto;
}

.access-card__note {
  margin-top: var(--space-3);
}
</style>
