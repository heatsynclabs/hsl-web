<template>
  <Card eyebrow="Audit" title="Who changed what">
    <LoadState :pending="pending" :error="error" @retry="reload">
      <Note>
        Newest first. Nothing here can be edited or deleted, which is what makes it worth reading
        after a mistake.
      </Note>

      <AuditTable :entries="entries" :names="names" />

      <div v-if="before !== null" class="audit__more">
        <Button :disabled="loadingMore" @click="loadOlder">
          {{ loadingMore ? 'Reading' : 'Load older entries' }}
        </Button>
      </div>
      <Note v-else-if="entries.length > 0" class="audit__end">That is the whole log.</Note>

      <p v-if="olderError" class="audit__error" role="alert">{{ olderError.message }}</p>
    </LoadState>
  </Card>
</template>

<script setup lang="ts">
import { ApiError } from '@hsl/api-client'
import type { AuditEntry } from '@hsl/schema'
import { Button, Card, Note } from '@hsl/ui'
import { onMounted, ref } from 'vue'

import { api } from '../api.ts'
import AuditTable from '../components/AuditTable.vue'
import LoadState from '../components/LoadState.vue'

/**
 * Paging walks backwards by id with the before parameter the contract already
 * carries, because rows are only ever appended and an offset would shift under
 * the reader between one page and the next.
 */
const PAGE = 50

const entries = ref<AuditEntry[]>([])
const names = ref(new Map<string, string>())
const before = ref<number | null>(null)
const pending = ref(true)
const loadingMore = ref(false)
const error = ref<ApiError | null>(null)
const olderError = ref<ApiError | null>(null)

/** The log stores member ids. The directory is where the names are. */
async function loadNames(): Promise<void> {
  try {
    const answer = await api.members()
    names.value = new Map(answer.members.map((member) => [member.id, member.name]))
  } catch (thrown) {
    // Names are a nicety. Without them the log still reads, with ids.
    if (!(thrown instanceof ApiError)) throw thrown
  }
}

async function reload(): Promise<void> {
  pending.value = true
  error.value = null

  try {
    const answer = await api.auditLog({ limit: PAGE })
    entries.value = answer.entries
    before.value = answer.nextBefore
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    error.value = thrown
  } finally {
    pending.value = false
  }
}

async function loadOlder(): Promise<void> {
  const cursor = before.value
  if (cursor === null) return

  loadingMore.value = true
  olderError.value = null

  try {
    const answer = await api.auditLog({ limit: PAGE, before: cursor })
    entries.value = [...entries.value, ...answer.entries]
    before.value = answer.nextBefore
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    olderError.value = thrown
  } finally {
    loadingMore.value = false
  }
}

onMounted(async () => {
  await reload()
  await loadNames()
})
</script>

<style scoped>
.audit__more,
.audit__end {
  display: block;
  margin-top: var(--space-4);
}

.audit__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
