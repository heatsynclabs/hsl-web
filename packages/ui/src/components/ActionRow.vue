<template>
  <div class="action-row">
    <span class="action-row__what"><slot /></span>
    <span class="action-row__when">{{ when }}</span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  when: string
}

defineProps<Props>()
</script>

<style scoped>
.action-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  border-bottom: 1px solid var(--g-line);
  padding: var(--space-2) 2px;
  font-size: 13px;
  color: var(--g-ink);
}

.action-row__when {
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
  color: var(--g-ink-3);
}
</style>
