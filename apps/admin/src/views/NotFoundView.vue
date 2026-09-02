<template>
  <Card eyebrow="Address" title="No screen here">
    <p class="notfound__body">
      This app has a directory, a member screen, an audit log and a payments form, and nothing at
      the address you asked for.
    </p>
    <RouterLink class="notfound__link" :to="{ name: 'directory' }">Go to the directory</RouterLink>
  </Card>
</template>

<script setup lang="ts">
import { Card } from '@hsl/ui'
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.notfound__body {
  margin: 0 0 var(--space-4);
  max-width: 60ch;
  line-height: var(--leading-normal);
}

.notfound__link {
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--accent-text);
}
</style>
