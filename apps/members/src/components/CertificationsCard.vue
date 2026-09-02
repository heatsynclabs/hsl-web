<template>
  <Card eyebrow="Certifications" title="Certified on">
    <div class="certifications-card__scroll">
      <DataTable
        :columns="COLUMNS"
        :rows="rows"
        empty-text="No certifications recorded yet. An instructor records one after the class."
      />
    </div>
    <Note class="certifications-card__note">
      Certification classes are on the public calendar.
    </Note>
  </Card>
</template>

<script setup lang="ts">
import type { HeldCertification } from '@hsl/schema'
import type { DataColumn, DataRow } from '@hsl/ui'
import { Card, DataTable, Note } from '@hsl/ui'
import { computed } from 'vue'

import { formatDay } from '../lib/format'

interface Props {
  certifications: HeldCertification[]
}

const props = defineProps<Props>()

const COLUMNS: DataColumn[] = [
  { key: 'tool', label: 'Tool' },
  { key: 'granted', label: 'Granted' },
  { key: 'by', label: 'By' },
]

const rows = computed<DataRow[]>(() =>
  props.certifications.map((held) => ({
    tool: held.name,
    granted: formatDay(held.grantedAt),
    // 415 legacy rows carry a grantor id that points at no row, so the name can
    // be missing without the record being wrong.
    by: held.grantedByName ?? 'Not recorded',
  })),
)
</script>

<style scoped>
.certifications-card__scroll {
  overflow-x: auto;
}

.certifications-card__note {
  margin-top: var(--space-3);
}
</style>
