<template>
  <section class="step">
    <p class="step__count">Step {{ position }} of {{ STEP_NAMES.length }}</p>
    <ol class="step__track">
      <li
        v-for="(name, index) in STEP_NAMES"
        :key="name"
        class="step__cell"
        :class="{ 'step__cell--now': name === step, 'step__cell--past': index < position - 1 }"
        :aria-current="name === step ? 'step' : undefined"
      >
        <span class="step__number">{{ index + 1 }}</span>
        <span class="step__label">{{ STEP_LABELS[name] }}</span>
      </li>
    </ol>

    <h1 class="step__title">{{ title }}</h1>
    <p v-if="lede" class="step__lede">{{ lede }}</p>

    <slot />

    <div class="step__actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { STEP_LABELS, STEP_NAMES, type StepName } from '../join-flow.ts'

interface Props {
  step: StepName
  title: string
  lede?: string
}

const props = withDefaults(defineProps<Props>(), {
  lede: undefined,
})

const position = computed(() => STEP_NAMES.indexOf(props.step) + 1)
</script>

<style scoped>
.step {
  max-width: 620px;
}

.step__count {
  margin: 0 0 var(--space-2);
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent-text);
}

.step__track {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0 0 var(--space-6);
  padding: 0;
  list-style: none;
}

.step__cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  border: var(--bd-2);
  padding: 5px 10px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.step__cell--past {
  color: var(--g-ink-2);
  background: var(--hazard-dim);
}

.step__cell--now {
  background: var(--hazard);
  border-color: var(--tape-dark);
  color: var(--tape-dark);
  box-shadow: var(--shadow-sm);
}

.step__number {
  font-family: var(--font-display);
  font-size: 12px;
}

.step__title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  text-transform: uppercase;
  color: var(--g-ink);
}

.step__lede {
  margin: 0 0 var(--space-6);
  max-width: 60ch;
  color: var(--g-ink-2);
}

.step__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

@media (max-width: 520px) {
  .step__label {
    display: none;
  }
}
</style>
