<template>
  <div class="tile" :class="`tile--${state}`">
    <p class="tile__label">{{ label }}</p>
    <p class="tile__value">{{ value }}</p>
  </div>
</template>

<script setup lang="ts">
interface Props {
  label: string
  value: string
  state?: 'locked' | 'unlocked' | 'unknown'
}

withDefaults(defineProps<Props>(), {
  state: 'unknown',
})
</script>

<style scoped>
.tile {
  border: var(--bd-2);
  padding: var(--space-4);
  text-align: center;
}

.tile--unlocked {
  background: var(--hazard-dim);
}

.tile--locked {
  background: var(--g-plate);
}

/* The door service answers 503 when the lab link is down. The tile says so
   rather than guessing, so nobody reads a stale state as a live one. */
.tile--unknown {
  background: transparent;
  border-style: dashed;
}

.tile__label {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 10px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.tile__value {
  margin: var(--space-1) 0 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: var(--font-bold);
  line-height: var(--leading-snug);
  text-transform: uppercase;
  color: var(--g-ink);
}
</style>
