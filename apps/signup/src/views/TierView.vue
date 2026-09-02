<template>
  <StepPage
    step="tier"
    title="What you pay"
    lede="Pick the tier you are joining at. Dues are month to month, and an admin can change your tier later."
  >
    <div class="tiers" role="radiogroup" aria-label="Dues tier">
      <label
        v-for="choice in TIER_CHOICES"
        :key="choice.level"
        class="tier"
        :class="{ 'tier--picked': join.draft.memberLevel === choice.level }"
      >
        <input
          v-model="join.draft.memberLevel"
          class="tier__radio"
          type="radio"
          name="tier"
          :value="choice.level"
        >
        <span class="tier__dues">{{ choice.dues }}</span>
        <span class="tier__label">{{ choice.label }}</span>
      </label>
    </div>

    <p v-if="errors.memberLevel" class="tier__error">{{ errors.memberLevel }}</p>

    <div class="tiers__note">
      <Note>
        Volunteer records member level 10 and no dues. The next screen says how to send the money
        for the other three. Nothing in this app takes a card number.
      </Note>
    </div>

    <div v-if="join.failure" class="tier__failure">
      <p class="tier__failure-text">{{ join.failure.message }}</p>
      <Link v-if="join.failure.offerSignIn" href="/">Go to sign in</Link>
    </div>

    <template #actions>
      <Button :disabled="join.submitting" @click="goBack">Back</Button>
      <Button variant="primary" :disabled="join.submitting" @click="send">
        {{ join.submitting ? 'Sending' : 'Create my account' }}
      </Button>
    </template>
  </StepPage>
</template>

<script setup lang="ts">
import { Button, Link, Note } from '@hsl/ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { api } from '../api.ts'
import StepPage from '../components/StepPage.vue'
import { errorsOn, join, submitJoin, TIER_CHOICES } from '../join-flow.ts'

const router = useRouter()
const errors = computed(() => errorsOn('tier'))

function goBack(): void {
  void router.push({ name: 'waiver' })
}

/** The only write this app makes, and it happens once, here. */
async function send(): Promise<void> {
  if (await submitJoin(api)) await router.push({ name: 'done' })
}
</script>

<style scoped>
.tiers {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr;
}

@media (min-width: 620px) {
  .tiers {
    grid-template-columns: 1fr 1fr;
  }
}

.tier {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border: var(--bd-2);
  background: var(--g-raised);
  padding: var(--space-4);
  cursor: pointer;
}

.tier--picked {
  background: var(--hazard);
  border-color: var(--tape-dark);
  color: var(--tape-dark);
  box-shadow: var(--shadow-sm);
}

.tier__radio {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.tier__radio:focus-visible + .tier__dues {
  outline: 2px solid var(--hazard);
  outline-offset: 3px;
}

.tier__dues {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  text-transform: uppercase;
  line-height: var(--leading-tight);
}

.tier__label {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
}

.tiers__note {
  margin-top: var(--space-4);
}

.tier__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: var(--tracking-wide);
  color: var(--ink-err);
}

.tier__failure {
  border: var(--bd-2);
  border-left: 6px solid var(--fault);
  background: var(--g-raised);
  padding: var(--space-4);
  margin-top: var(--space-5);
}

.tier__failure-text {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--g-ink);
}
</style>
