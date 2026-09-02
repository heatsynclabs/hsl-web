<template>
  <p class="note"><slot /></p>
</template>

<style scoped>
.note {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 11px;
  line-height: var(--leading-normal);
  letter-spacing: var(--tracking-wide);
  color: var(--g-ink-3);
}
</style>
