<template>
  <a class="link" :href="href"><slot /></a>
</template>

<script setup lang="ts">
interface Props {
  href: string
}

defineProps<Props>()
</script>

<style scoped>
.link {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  border-bottom: 1px solid var(--g-line);
  padding-bottom: 1px;
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  text-decoration: none;
  color: var(--accent-text);
}

.link:hover {
  border-bottom-color: var(--hazard);
}
</style>
