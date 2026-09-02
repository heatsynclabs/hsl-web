<template>
  <Card eyebrow="Membership" :title="level">
    <KeyValue :rows="rows" />
    <Note class="membership-card__note">
      Payment method is recorded for the accountant. No screen in this app changes it, so ask an
      accountant if it is wrong.
    </Note>
  </Card>
</template>

<script setup lang="ts">
import type { MemberSelf, PaymentRecord, PaymentStatus } from '@hsl/schema'
import { memberLevelLabel } from '@hsl/schema'
import type { KeyValuePill, KeyValueRow } from '@hsl/ui'
import { Card, KeyValue, Note } from '@hsl/ui'
import { computed } from 'vue'

import { formatDay } from '../lib/format'

interface Props {
  member: MemberSelf
  paymentStatus: PaymentStatus
  payments: PaymentRecord[]
}

const props = defineProps<Props>()

/** The bands live in @hsl/schema so the API, this app and the import agree. */
const level = computed(() => memberLevelLabel(props.member.memberLevel) ?? 'No level recorded')

const STATUS_PILLS: Record<PaymentStatus, KeyValuePill> = {
  paid: { text: 'Paid', state: 'on' },
  lapsed: { text: 'Lapsed', state: 'plain' },
  'not-applicable': { text: 'No dues at this level', state: 'off' },
}

const lastPaid = computed(() => {
  const days = props.payments.map((payment) => payment.paidOn).sort()
  const newest = days.at(-1)
  return newest === undefined ? 'None recorded' : formatDay(newest)
})

const rows = computed<KeyValueRow[]>(() => [
  { label: 'Status', pills: [STATUS_PILLS[props.paymentStatus]] },
  { label: 'Last payment', value: lastPaid.value },
  { label: 'On file', value: props.member.paymentMethod ?? 'Nothing on file' },
  {
    label: 'Oriented',
    value:
      props.member.orientation === null
        ? 'Not yet'
        : `Yes, ${formatDay(props.member.orientation)}`,
  },
])
</script>

<style scoped>
.membership-card__note {
  margin-top: var(--space-3);
}
</style>
