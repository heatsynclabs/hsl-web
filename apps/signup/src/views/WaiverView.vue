<template>
  <StepPage
    step="waiver"
    title="The release"
    lede="Read this, then tick the box yourself. Nothing on this screen is ticked for you."
  >
    <Card eyebrow="Liability release" title="What you are accepting">
      <p class="waiver__para">
        HeatSync Labs is a working shop. It holds machine tools, welders, a laser cutter and other
        equipment that can hurt you or ruin what you brought in.
      </p>
      <p class="waiver__para">
        You agree to work within your training, to use a tool only once you hold the certification
        the lab requires for it, to follow the rules posted at each machine, and to take
        responsibility for what happens when you use the space.
      </p>
    </Card>

    <div class="waiver__caveat">
      <p class="waiver__para">
        This screen is not the signed instrument. The release the lab keeps is the paper form and
        the Google Form it uses today. Ticking the box records that you accepted the release and
        the time you accepted it, and that record points at the release rather than replacing it.
        The lab may still ask you to sign the paper copy.
      </p>
    </div>

    <label class="waiver__accept" :for="acceptId">
      <input
        :id="acceptId"
        v-model="join.draft.waiverAccepted"
        class="waiver__box"
        type="checkbox"
      >
      <span class="waiver__accept-text">I have read the release and I accept it.</span>
    </label>

    <Note v-if="!join.draft.waiverAccepted">
      Continue turns on when the box is ticked.
    </Note>

    <template #actions>
      <Button @click="goBack">Back</Button>
      <Button variant="primary" :disabled="!join.draft.waiverAccepted" @click="carryOn">
        Continue
      </Button>
    </template>
  </StepPage>
</template>

<script setup lang="ts">
import { Button, Card, Note } from '@hsl/ui'
import { useId } from 'vue'
import { useRouter } from 'vue-router'

import StepPage from '../components/StepPage.vue'
import { join, leaveStep } from '../join-flow.ts'

const router = useRouter()
const acceptId = useId()

function goBack(): void {
  void router.push({ name: 'emergency' })
}

function carryOn(): void {
  if (leaveStep('waiver')) void router.push({ name: 'tier' })
}
</script>

<style scoped>
.waiver__para {
  margin: 0 0 var(--space-3);
  line-height: var(--leading-relaxed);
}

.waiver__para:last-child {
  margin-bottom: 0;
}

.waiver__caveat {
  border: var(--bd-2);
  border-left: 6px solid var(--hazard);
  background: var(--g-plate);
  padding: var(--space-4);
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--g-ink-2);
}

.waiver__accept {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-height: var(--tap);
  border: var(--bd-2);
  background: var(--g-raised);
  padding: var(--space-4);
  margin-top: var(--space-4);
  cursor: pointer;
}

.waiver__box {
  flex: none;
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: var(--hazard);
}

.waiver__accept-text {
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: var(--leading-normal);
  color: var(--g-ink);
}
</style>
