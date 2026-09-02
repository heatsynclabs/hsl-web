<template>
  <div class="button-row"><slot /></div>
</template>

<style scoped>
.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Buttons in a row share the width evenly, which is how the allow and deny
   pair reads on a phone. */
.button-row > * {
  flex: 1 1 auto;
}
</style>
