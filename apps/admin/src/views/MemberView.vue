<template>
  <LoadState :pending="pending" :error="error" @retry="load">
    <div v-if="record">
      <Card eyebrow="Member" :title="record.member.name">
        <KeyValue :rows="summaryRows" />
        <Note class="member__audit">
          Every change on this screen is written to the audit log with your name and the time.
          There is no approval step: what you change here takes effect when you save it, and the
          audit screen is where it can be found afterwards.
        </Note>
      </Card>

      <div class="member__grid">
        <Card eyebrow="Access" title="Card access">
          <CardAccessControl
            :member-name="record.member.name"
            :card-access="record.member.cardAccess"
            :saving="busy === 'access'"
            :error="errorFor('access')"
            @set="setCardAccess"
          />
        </Card>

        <Card eyebrow="Record" title="Roles and level">
          <MemberRolesForm
            :member="record.member"
            :saving="busy === 'profile'"
            :error="errorFor('profile')"
            @save="saveProfile"
          />
        </Card>

        <Card eyebrow="Cards" title="Cards held">
          <MemberCards
            :cards="record.cards"
            :saving="busy === 'card'"
            :assigned-slot="assignedSlot"
            :error="errorFor('card')"
            @assign="assignCard"
            @deactivate="deactivateCard"
          />
        </Card>

        <Card eyebrow="Training" title="Certifications">
          <MemberCertifications
            :held="record.certifications"
            :catalogue="catalogue"
            :saving="busy === 'cert'"
            :error="errorFor('cert')"
            @grant="grantCertification"
            @revoke="revokeCertification"
          />
        </Card>
      </div>
    </div>
  </LoadState>
</template>

<script setup lang="ts">
import { ApiError } from '@hsl/api-client'
import type { CertificationRecord, MemberResponse, PatchMemberRequest } from '@hsl/schema'
import type { KeyValueRow } from '@hsl/ui'
import { Card, KeyValue, Note } from '@hsl/ui'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { api } from '../api.ts'
import CardAccessControl from '../components/CardAccessControl.vue'
import LoadState from '../components/LoadState.vue'
import MemberCards from '../components/MemberCards.vue'
import MemberCertifications from '../components/MemberCertifications.vue'
import MemberRolesForm from '../components/MemberRolesForm.vue'
import { paymentLabel, paymentPill } from '../lib/directory.ts'
import { whenText } from '../lib/format.ts'

/**
 * One member, and every field PATCH /api/members/:id can change. The screen
 * fetches; the components under it take props and emit what an admin asked for.
 *
 * hidden is on the member row but not on that route's request schema, which
 * refuses any key it does not name, so this screen reports it and does not
 * offer to change it.
 */

const route = useRoute()
const memberId = computed(() => String(route.params['id'] ?? ''))

const record = ref<MemberResponse | null>(null)
const catalogue = ref<CertificationRecord[]>([])
const pending = ref(true)
const error = ref<ApiError | null>(null)

const busy = ref<string | null>(null)
const failure = ref<{ key: string; error: ApiError } | null>(null)
const assignedSlot = ref<number | null>(null)

function errorFor(key: string): ApiError | null {
  return failure.value?.key === key ? failure.value.error : null
}

const summaryRows = computed<KeyValueRow[]>(() => {
  const answer = record.value
  if (answer === null) return []

  const member = answer.member
  return [
    { label: 'Email', value: member.email },
    {
      label: 'Dues',
      pills: [{ text: paymentLabel(answer.paymentStatus), state: paymentPill(answer.paymentStatus) }],
    },
    { label: 'Oriented', value: whenText(member.orientation) },
    { label: 'Waiver', value: whenText(member.waiver) },
    { label: 'Member since', value: whenText(member.createdAt) },
    {
      label: 'Hidden',
      value: member.hidden
        ? 'Yes. The member set this on their own profile and it keeps them out of the directory.'
        : 'No',
    },
  ]
})

async function load(): Promise<void> {
  pending.value = true
  error.value = null

  try {
    const [answer, tools] = await Promise.all([api.member(memberId.value), api.certifications()])
    record.value = answer
    catalogue.value = tools.certifications
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    error.value = thrown
  } finally {
    pending.value = false
  }
}

/** One write, with the busy flag and the refusal that belongs to that control. */
async function run(key: string, work: () => Promise<void>): Promise<void> {
  busy.value = key
  failure.value = null

  try {
    await work()
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown
    failure.value = { key, error: thrown }
  } finally {
    busy.value = null
  }
}

function saveProfile(changes: PatchMemberRequest): Promise<void> {
  return run('profile', async () => {
    record.value = await api.updateMember(memberId.value, changes)
  })
}

function setCardAccess(value: boolean): Promise<void> {
  return run('access', async () => {
    record.value = await api.updateMember(memberId.value, { cardAccess: value })
  })
}

function assignCard(request: { cardNumber: string; label?: string }): Promise<void> {
  return run('card', async () => {
    const answer = await api.assignCard({ userId: memberId.value, ...request })
    assignedSlot.value = answer.card.slot
    record.value = await api.member(memberId.value)
  })
}

function deactivateCard(slot: number): Promise<void> {
  return run('card', async () => {
    await api.updateCard(slot, { active: false })
    assignedSlot.value = null
    record.value = await api.member(memberId.value)
  })
}

function grantCertification(slug: string): Promise<void> {
  return run('cert', async () => {
    const answer = await api.grantCertification(memberId.value, { slug })
    if (record.value !== null) record.value.certifications = answer.certifications
  })
}

function revokeCertification(slug: string): Promise<void> {
  return run('cert', async () => {
    const answer = await api.revokeCertification(memberId.value, slug)
    if (record.value !== null) record.value.certifications = answer.certifications
  })
}

onMounted(load)
</script>

<style scoped>
.member__audit {
  display: block;
  margin-top: var(--space-4);
  border-left: 3px solid var(--hazard);
  padding-left: var(--space-3);
}

.member__grid {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-4);
  grid-template-columns: 1fr;
}

@media (min-width: 840px) {
  .member__grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
