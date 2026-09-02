<template>
  <div class="audit__table">
    <DataTable :columns="COLUMNS" :rows="tableRows" empty-text="Nothing has been changed yet.">
      <template #cell-action="{ row }">
        <Pill :state="actionState(String(row['action']))">{{ row['action'] }}</Pill>
      </template>
      <template #cell-target="{ row }">
        <RouterLink
          v-if="row['targetId']"
          class="audit__target"
          :to="{ name: 'member', params: { id: row['targetId'] } }"
        >
          {{ row['target'] }}
        </RouterLink>
        <span v-else>{{ row['target'] }}</span>
      </template>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import type { AuditEntry } from '@hsl/schema'
import type { DataColumn, DataRow } from '@hsl/ui'
import { DataTable, Pill } from '@hsl/ui'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { actionState, detailText, targetText } from '../lib/audit.ts'
import { whenText } from '../lib/format.ts'

/**
 * The append-only log, newest first. It is the screen that replaced the
 * approval queue, so it is the only place a mistaken grant becomes visible.
 */
interface Props {
  entries: AuditEntry[]
  /** Member id to name, from the directory. Ids that are not in it print as ids. */
  names: ReadonlyMap<string, string>
}

const props = defineProps<Props>()

const COLUMNS: DataColumn[] = [
  { key: 'when', label: 'When', mono: true },
  { key: 'actor', label: 'Actor' },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target' },
  { key: 'detail', label: 'Detail', mono: true },
]

const tableRows = computed<DataRow[]>(() =>
  props.entries.map((entry) => ({
    when: whenText(entry.at),
    actor: entry.actorName ?? entry.actorId ?? 'the system',
    action: entry.action,
    target: targetText(entry.targetId, props.names),
    targetId: entry.targetId ?? '',
    detail: detailText(entry.action, entry.detail),
  })),
)
</script>

<style scoped>
.audit__table {
  overflow-x: auto;
}

.audit__target {
  color: var(--g-ink);
  text-decoration: underline;
  text-decoration-color: var(--hazard);
  text-underline-offset: 3px;
}
</style>
