<template>
  <section class="login">
    <div class="login__mark">
      <Mark :name="mark" :height="44" />
    </div>
    <h2 class="login__title">{{ title }}</h2>
    <p v-if="subtitle" class="login__subtitle">{{ subtitle }}</p>
    <slot />
  </section>
</template>

<script setup lang="ts">
import Mark from './Mark.vue'
import type { MarkName } from '../marks'

interface Props {
  title: string
  subtitle?: string
  mark?: MarkName
}

withDefaults(defineProps<Props>(), {
  subtitle: undefined,
  mark: 'hsl-mark-1c-current',
})
</script>

<style scoped>
.login {
  padding: var(--space-6) var(--space-5);
  color: var(--g-ink);
}

.login__mark {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-3);
}

.login__title {
  margin: 0 0 var(--space-1);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: var(--font-bold);
  text-transform: uppercase;
  text-align: center;
}

.login__subtitle {
  margin: 0 0 var(--space-5);
  font-family: var(--font-ui);
  font-size: 12px;
  text-align: center;
  color: var(--g-ink-3);
}
</style>
