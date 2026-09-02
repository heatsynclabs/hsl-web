<template>
  <div>
    <ActionRow v-for="event in events" :key="event.id" :when="whenText(event.at)">
      {{ eventText(event) }}
    </ActionRow>

    <Note v-if="events.length === 0">
      The door service has not reported anything yet. It posts what it read off the controller on
      every pass, about once a minute.
    </Note>

    <Note class="events__note">
      The newest fifty lines the door service posted. The lasting record of who changed what is
      the audit log.
    </Note>
  </div>
</template>

<script setup lang="ts">
import type { DoorEventEntry } from '@hsl/schema'
import { ActionRow, Note } from '@hsl/ui'

import { eventText } from '../lib/door.ts'
import { whenText } from '../lib/format.ts'

/**
 * The door's own history, newest first. Every kind the door service writes gets
 * a sentence, and a kind this screen has never seen prints its name and its
 * detail rather than nothing.
 */
interface Props {
  events: DoorEventEntry[]
}

defineProps<Props>()
</script>

<style scoped>
.events__note {
  display: block;
  margin-top: var(--space-3);
}
</style>
