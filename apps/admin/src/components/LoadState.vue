<template>
  <p v-if="pending" class="load">Reading from the API.</p>
  <div v-else-if="error" class="load load--error" role="alert">
    <p class="load__message">{{ error.message }}</p>
    <Button @click="emit('retry')">Try again</Button>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import { Button } from '@hsl/ui'

/**
 * Loading, and the failure a person can act on. An ApiError already says what
 * happened, what the system did and what to do next, so the screen prints its
 * sentence rather than writing a worse one of its own.
 */
interface Props {
  pending: boolean
  error: ApiError | null
}

defineProps<Props>()

const emit = defineEmits<{ retry: [] }>()
</script>

<style scoped>
.load {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 12px;
  letter-spacing: var(--tracking-wide);
  color: var(--g-ink-3);
}

.load--error {
  border: var(--bd-2);
  border-left: 6px solid var(--fault);
  background: var(--g-raised);
  padding: var(--space-4);
}

.load__message {
  margin: 0 0 var(--space-3);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: var(--leading-normal);
  color: var(--g-ink);
}
</style>
