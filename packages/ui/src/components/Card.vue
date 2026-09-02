<template>
  <section class="card">
    <p v-if="eyebrow" class="card__eyebrow">{{ eyebrow }}</p>
    <h3 v-if="title" class="card__title">{{ title }}</h3>
    <slot />
  </section>
</template>

<script setup lang="ts">
interface Props {
  eyebrow?: string
  title?: string
}

withDefaults(defineProps<Props>(), {
  eyebrow: undefined,
  title: undefined,
})
</script>

<style scoped>
.card {
  border: var(--bd-2);
  background: var(--g-raised);
  padding: var(--space-4) var(--space-5);
}

.card__eyebrow {
  margin: 0 0 var(--space-2);
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent-text);
}

.card__title {
  margin: 0 0 var(--space-3);
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: var(--font-bold);
  line-height: var(--leading-snug);
  text-transform: uppercase;
  color: var(--g-ink);
}
</style>
