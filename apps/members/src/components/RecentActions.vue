<template>
  <Card eyebrow="Recent" title="Remote actions">
    <ActionRow
      v-for="(entry, index) in entries"
      :key="index"
      :when="formatTimeOfDay(entry.at)"
    >
      {{ entry.what }}
    </ActionRow>
    <Note v-if="entries.length === 0">Nothing yet on this visit.</Note>
    <Note class="recent-actions__note">
      This list is what this browser has done since the screen opened. The lasting record is the
      audit log, which an admin reads.
    </Note>
  </Card>
</template>

<script lang="ts">
export interface DoorAction {
  what: string
  /** ISO timestamp of the moment, rendered as a time of day. */
  at: string
}
</script>

<script setup lang="ts">
import { ActionRow, Card, Note } from '@hsl/ui'

import { formatTimeOfDay } from '../lib/format'

interface Props {
  entries: DoorAction[]
}

defineProps<Props>()
</script>

<style scoped>
.recent-actions__note {
  margin-top: var(--space-3);
}
</style>
