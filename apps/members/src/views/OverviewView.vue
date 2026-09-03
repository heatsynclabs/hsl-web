<template>
  <section class="overview">
    <div v-if="failure" class="overview__failed" role="alert">
      <p class="overview__failed-text">{{ failure.message }}</p>
      <ButtonRow>
        <Button v-if="failure.status === NO_SESSION" variant="primary" href="/sign-in">
          Sign in
        </Button>
        <Button v-else variant="primary" @click="reload">Try again</Button>
      </ButtonRow>
    </div>

    <div v-else-if="me" class="overview__grid">
      <ProfileForm
        v-if="editing"
        :member="me.member"
        :saving="saving"
        :error="saveError"
        @save="save"
        @cancel="editing = false"
      />
      <ProfileCard v-else :member="me.member" @edit="editing = true" />
      <MembershipCard
        :member="me.member"
        :payment-status="me.paymentStatus"
        :payments="me.payments"
      />
      <AccessCard :cards="me.cards" />
      <CertificationsCard :certifications="me.certifications" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ApiError, refreshSession } from '@hsl/api-client'
import type { MeResponse, PatchMeRequest } from '@hsl/schema'
import { Button, ButtonRow } from '@hsl/ui'
import { ref } from 'vue'

import AccessCard from '../components/AccessCard.vue'
import CertificationsCard from '../components/CertificationsCard.vue'
import MembershipCard from '../components/MembershipCard.vue'
import ProfileCard from '../components/ProfileCard.vue'
import ProfileForm from '../components/ProfileForm.vue'
import { useApi } from '../lib/api'

/** The API answers this when the session cookie has gone since the page loaded. */
const NO_SESSION = 401

const api = useApi()

const me = ref<MeResponse | null>(null)
const failure = ref<ApiError | null>(null)
const editing = ref(false)
const saving = ref(false)
const saveError = ref('')

// Awaited in setup so the screen is never drawn half filled. App.vue holds the
// Suspense boundary that shows Loading while this runs.
try {
  me.value = await api.me()
} catch (error) {
  if (!(error instanceof ApiError)) throw error
  failure.value = error
}

async function save(changes: PatchMeRequest): Promise<void> {
  saving.value = true
  saveError.value = ''

  try {
    me.value = await api.updateMe(changes)
    editing.value = false
    // The app bar prints the member's name, so it has to hear about a rename.
    await refreshSession(api)
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    // The API writes a sentence a member can act on. error.message wraps it in
    // the method, the path and "the caller", which is for a log, not a person.
    saveError.value = error.problem ?? error.message
  } finally {
    saving.value = false
  }
}

function reload(): void {
  window.location.reload()
}
</script>

<style scoped>
.overview__grid {
  display: grid;
  align-items: start;
  gap: var(--space-4);
  grid-template-columns: 1fr 1fr;
}

/* One column on a phone. The cards keep their order, so Profile stays first. */
@media (max-width: 720px) {
  .overview__grid {
    grid-template-columns: 1fr;
  }
}

.overview__failed {
  border: var(--bd-2);
  border-color: var(--fault);
  padding: var(--space-4);
}

.overview__failed-text {
  margin: 0 0 var(--space-4);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: var(--leading-normal);
  color: var(--ink-err);
}
</style>
