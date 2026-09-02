<template>
  <Card eyebrow="Door access" title="How to get the controls">
    <p class="door-access-help__body">
      Opening and locking the doors from here needs card access on your member record. It is one
      setting an admin turns on, and the change is written to the audit log with who made it and
      when. Ask an admin at the space.
    </p>
    <p class="door-access-help__body">
      A card you already hold keeps working at the reader whatever this screen says. The controller
      holds its own card table, so the building does not depend on this app being up.
    </p>
  </Card>
</template>

<script setup lang="ts">
import { Card } from '@hsl/ui'
</script>

<style scoped>
.door-access-help__body {
  margin: 0 0 var(--space-3);
  font-size: 14px;
  line-height: var(--leading-normal);
  color: var(--g-ink);
}

.door-access-help__body:last-child {
  margin-bottom: 0;
}
</style>
