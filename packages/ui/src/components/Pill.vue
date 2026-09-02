<template>
  <span class="pill" :class="`pill--${state}`"><slot /></span>
</template>

<script lang="ts">
export type PillState = 'plain' | 'on' | 'dim' | 'off'
</script>

<script setup lang="ts">
interface Props {
  state?: PillState
}

withDefaults(defineProps<Props>(), {
  state: 'plain',
})
</script>

<style scoped>
.pill {
  display: inline-block;
  border: 1px solid var(--g-line-hi);
  padding: 3px 8px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--g-ink-2);
}

.pill--on {
  background: var(--hazard);
  border-color: var(--tape-dark);
  color: var(--tape-dark);
}

.pill--dim {
  background: var(--hazard-dim);
  color: var(--g-ink);
}

.pill--off {
  opacity: 0.65;
}
</style>
