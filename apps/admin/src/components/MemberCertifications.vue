<template>
  <div>
    <div class="certs__table">
      <DataTable
        :columns="COLUMNS"
        :rows="tableRows"
        empty-text="No certification recorded for this member."
      >
        <template #cell-action="{ row }">
          <Button :disabled="saving" @click="emit('revoke', String(row['slug']))">Revoke</Button>
        </template>
      </DataTable>
    </div>

    <form class="certs__form" @submit.prevent="grant">
      <label class="certs__field">
        <span class="certs__label">Grant a certification</span>
        <select v-model="chosen" class="certs__input">
          <option value="">Pick a tool</option>
          <option v-for="option in grantable" :key="option.slug" :value="option.slug">
            {{ option.name }}
          </option>
        </select>
      </label>
      <Note v-if="grantable.length === 0">
        This member already holds every certification on the tool list.
      </Note>
      <Button variant="primary" type="submit" :disabled="saving || chosen === ''">
        {{ saving ? 'Saving' : 'Grant' }}
      </Button>
    </form>

    <p v-if="error" class="certs__error" role="alert">{{ error.message }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ApiError } from '@hsl/api-client'
import type { CertificationRecord, HeldCertification } from '@hsl/schema'
import type { DataColumn, DataRow } from '@hsl/ui'
import { Button, DataTable, Note } from '@hsl/ui'
import { computed, ref } from 'vue'

import { whenText } from '../lib/format.ts'

/**
 * Who trained this member on what. The join carries the grantor and the date
 * because the legacy database has 415 rows carrying exactly that.
 */
interface Props {
  held: HeldCertification[]
  catalogue: CertificationRecord[]
  saving: boolean
  error: ApiError | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ grant: [slug: string]; revoke: [slug: string] }>()

const COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Tool' },
  { key: 'granted', label: 'Granted' },
  { key: 'by', label: 'By' },
  { key: 'action', label: '' },
]

const chosen = ref('')

const tableRows = computed<DataRow[]>(() =>
  props.held.map((row) => ({
    slug: row.slug,
    name: row.name,
    granted: whenText(row.grantedAt),
    by: row.grantedByName ?? 'not recorded',
    action: '',
  })),
)

const grantable = computed(() => {
  const alreadyHeld = new Set(props.held.map((row) => row.slug))
  return props.catalogue.filter((option) => !alreadyHeld.has(option.slug))
})

function grant(): void {
  if (chosen.value === '') return

  emit('grant', chosen.value)
  chosen.value = ''
}
</script>

<style scoped>
.certs__table {
  overflow-x: auto;
}

.certs__form {
  margin-top: var(--space-5);
  border-top: 1px solid var(--g-line);
  padding-top: var(--space-4);
}

.certs__field {
  display: block;
  margin-bottom: var(--space-3);
}

.certs__label {
  display: block;
  margin-bottom: 5px;
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--g-ink-3);
}

.certs__input {
  width: 100%;
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-plate);
  padding: 10px 12px;
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--g-ink);
}

.certs__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
