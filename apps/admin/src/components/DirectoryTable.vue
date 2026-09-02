<template>
  <DataTable :columns="COLUMNS" :rows="tableRows" :empty-text="emptyText">
    <template #cell-name="{ row }">
      <RouterLink class="directory__name" :to="{ name: 'member', params: { id: row['id'] } }">
        {{ row['name'] }}
      </RouterLink>
      <span v-if="row['email']" class="directory__email">{{ row['email'] }}</span>
    </template>
    <template #cell-status="{ row }">
      <Pill :state="pillFor(row['statusKey'])">{{ row['status'] }}</Pill>
    </template>
  </DataTable>
</template>

<script setup lang="ts">
import type { PaymentStatus } from '@hsl/schema'
import type { DataColumn, DataRow, PillState } from '@hsl/ui'
import { DataTable, Pill } from '@hsl/ui'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import type { DirectoryRow } from '../lib/directory.ts'
import { paymentLabel, paymentPill } from '../lib/directory.ts'

/**
 * The four columns the mockup shows. Card and dues status are not in the
 * directory response, so a row whose member record has not been read yet says
 * so instead of printing a card state nobody checked.
 */
interface Props {
  rows: DirectoryRow[]
  /** What to print where the member record has not been read. */
  unknownText: string
  emptyText: string
}

const props = defineProps<Props>()

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'level', label: 'Level' },
  { key: 'card', label: 'Card', mono: true },
  { key: 'status', label: 'Status' },
]

const tableRows = computed<DataRow[]>(() =>
  props.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email ?? '',
    level: row.levelText,
    card: row.cardText ?? props.unknownText,
    status: row.paymentStatus === null ? props.unknownText : paymentLabel(row.paymentStatus),
    statusKey: row.paymentStatus ?? '',
  })),
)

function pillFor(key: string | undefined): PillState {
  if (key === undefined || key === '') return 'plain'
  return paymentPill(key as PaymentStatus)
}
</script>

<style scoped>
.directory__name {
  color: var(--g-ink);
  text-decoration: underline;
  text-decoration-color: var(--hazard);
  text-underline-offset: 3px;
}

.directory__email {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--g-ink-3);
}
</style>
