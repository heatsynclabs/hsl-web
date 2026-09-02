<template>
  <header class="appbar">
    <Mark name="hsl-mark-1c-current" />
    <span class="appbar__name">{{ appName }}</span>
    <span class="appbar__who"><slot /></span>
  </header>
</template>

<script setup lang="ts">
import Mark from './Mark.vue'

interface Props {
  appName: string
}

defineProps<Props>()
</script>

<style scoped>
.appbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  border-bottom: 2px solid var(--g-line-hi);
  background: var(--g-plate);
  padding: var(--space-3) var(--space-5);
  padding-left: max(var(--space-5), var(--safe-l));
  padding-right: max(var(--space-5), var(--safe-r));
  color: var(--g-ink);
}

.appbar__name {
  font-family: var(--font-display);
  font-size: 16px;
  letter-spacing: var(--tracking-normal);
  text-transform: uppercase;
}

.appbar__who {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  font-family: var(--font-ui);
  font-size: 12px;
  letter-spacing: var(--tracking-wide);
  color: var(--g-ink-2);
}
</style>
