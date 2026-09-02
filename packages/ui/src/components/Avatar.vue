<template>
  <span class="avatar" aria-hidden="true">{{ initials }}</span>
</template>

<script setup lang="ts">
interface Props {
  initials: string
}

defineProps<Props>()
</script>

<style scoped>
/* Decorative: the member's name is always printed next to it, so a screen
   reader that also announced the initials would say the person twice. */
.avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  background: var(--hazard);
  color: var(--tape-dark);
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: var(--font-bold);
}
</style>
