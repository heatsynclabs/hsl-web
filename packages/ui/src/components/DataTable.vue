<template>
  <table class="table">
    <thead>
      <tr>
        <th v-for="column in columns" :key="column.key" scope="col">{{ column.label }}</th>
      </tr>
    </thead>
    <tbody v-if="rows.length > 0">
      <tr v-for="(row, index) in rows" :key="index">
        <td v-for="column in columns" :key="column.key" :class="{ 'table__cell--mono': column.mono }">
          <slot :name="`cell-${column.key}`" :row="row">{{ row[column.key] }}</slot>
        </td>
      </tr>
    </tbody>
    <tbody v-else>
      <tr>
        <td class="table__empty" :colspan="columns.length">{{ emptyText }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script lang="ts">
export interface DataColumn {
  key: string
  label: string
  mono?: boolean
}

export type DataRow = Record<string, string>
</script>

<script setup lang="ts">
interface Props {
  columns: DataColumn[]
  rows: DataRow[]
  emptyText?: string
}

withDefaults(defineProps<Props>(), {
  emptyText: 'Nothing here yet.',
})

defineSlots<{
  [key: `cell-${string}`]: (props: { row: DataRow }) => unknown
}>()
</script>

<style scoped>
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  border-bottom: 2px solid var(--g-line-hi);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-align: left;
  color: var(--g-ink-3);
}

.table td {
  border-bottom: 1px solid var(--g-line);
  padding: var(--space-2) var(--space-3);
  vertical-align: top;
  color: var(--g-ink);
}

.table tbody tr:nth-child(even) td {
  background: var(--g-plate);
}

.table__cell--mono {
  font-family: var(--font-mono);
  font-size: 12px;
}

.table__empty {
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-wide);
  color: var(--g-ink-3);
}
</style>
