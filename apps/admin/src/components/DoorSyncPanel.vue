<template>
  <div>
    <Note>
      The card table is pushed to the controller about once a minute whether anybody asks or not,
      so there is nothing to remember after assigning or deactivating a card. This button only
      shortens the wait.
    </Note>

    <Button class="sync__button" :disabled="saving" @click="emit('sync')">
      {{ saving ? 'Asking' : 'Sync now' }}
    </Button>

    <Note v-if="queuedAt" class="sync__queued">
      Asked at {{ whenText(queuedAt) }}. The door service picks it up on its next pass and writes
      whatever the table and the controller disagree about.
    </Note>

    <p v-if="error" class="sync__error" role="alert">{{ error.problem ?? error.message }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import { Button, Note } from '@hsl/ui'

import { whenText } from '../lib/format.ts'

/**
 * The legacy app called this cards#upload_all and an admin had to run it after
 * every change. Here the timer does it anyway, which is why the note says what
 * the button is worth rather than leaving somebody to guess.
 */
interface Props {
  saving: boolean
  /** When the API took the request, or null when none has been made this visit. */
  queuedAt: string | null
  error: ApiError | null
}

defineProps<Props>()
const emit = defineEmits<{ sync: [] }>()
</script>

<style scoped>
.sync__button {
  margin-top: var(--space-3);
}

.sync__queued {
  display: block;
  margin-top: var(--space-3);
}

.sync__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
