<template>
  <dl class="kv">
    <template v-for="row in rows" :key="row.label">
      <dt class="kv__label">{{ row.label }}</dt>
      <dd class="kv__value">
        <span v-if="row.value">{{ row.value }}</span>
        <Pill v-for="pill in row.pills" :key="pill.text" :state="pill.state">{{ pill.text }}</Pill>
      </dd>
    </template>
  </dl>
</template>

<script lang="ts">
import type { PillState } from './Pill.vue'

export interface KeyValuePill {
  text: string
  state?: PillState
}

export interface KeyValueRow {
  label: string
  value?: string
  pills?: KeyValuePill[]
}
</script>

<script setup lang="ts">
import Pill from './Pill.vue'

interface Props {
  rows: KeyValueRow[]
}

defineProps<Props>()
</script>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: 14px;
}

.kv__label {
  padding-top: 2px;
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.kv__value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--g-ink);
}
</style>
