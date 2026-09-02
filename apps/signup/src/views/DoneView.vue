<template>
  <StepPage step="done" title="Your account exists" :lede="lede">
    <Card v-if="join.created === null" eyebrow="Nothing yet" title="No account was created">
      <p class="done__para">
        This screen says what happens after you join, and nothing has been sent. Start at the
        account step and the flow brings you back here.
      </p>
    </Card>

    <ol v-else class="done__steps">
      <li v-if="owesDues" class="done__step">
        <p class="done__what">Send your dues</p>
        <p class="done__how">
          Zelle to finances@heatsynclabs.org is what the lab prefers. PayPal, cash and a cheque
          all work as well. This app never takes a card number, and it has recorded no payment.
        </p>
      </li>
      <li v-else class="done__step">
        <p class="done__what">No dues to send</p>
        <p class="done__how">
          You joined as a volunteer, so the lab expects no money. Ask an admin to move your tier
          if that changes.
        </p>
      </li>

      <li class="done__step">
        <p class="done__what">An admin records the payment</p>
        <p class="done__how">
          Dues are recorded by hand against your member record. Your dues read as paid in the
          members app once somebody has done that.
        </p>
      </li>

      <li class="done__step">
        <p class="done__what">Orientation is booked with a person</p>
        <p class="done__how">
          A member runs orientation with you. This app cannot book it, so ask at the lab and
          somebody will arrange a time.
        </p>
      </li>

      <li class="done__step">
        <p class="done__what">A card is issued after orientation</p>
        <p class="done__how">
          An admin gives you a card and puts it in a door slot. How soon door access follows
          orientation is a board rule rather than a setting in this app. The lab website and the
          bylaws do not currently say the same thing about it, so this screen names no number of
          days.
        </p>
      </li>
    </ol>

    <Note v-if="join.created !== null">
      Your acceptance of the release is recorded against your account, with the time you accepted
      it. The signed release itself is still the form the lab keeps.
    </Note>

    <template #actions>
      <Button v-if="join.created === null" variant="primary" @click="startOver">
        Start at step one
      </Button>
      <Link v-else href="/">Open the members app</Link>
    </template>
  </StepPage>
</template>

<script setup lang="ts">
import { Button, Card, Link, Note } from '@hsl/ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import StepPage from '../components/StepPage.vue'
import { join, LOWEST_PAYING_LEVEL, resetJoin } from '../join-flow.ts'

const router = useRouter()

const lede = computed(() =>
  join.created === null
    ? 'Nothing has been sent to the lab.'
    : `The lab has an account for ${join.created.email}. Here is what happens next.`,
)

const owesDues = computed(() => (join.draft.memberLevel ?? 0) >= LOWEST_PAYING_LEVEL)

function startOver(): void {
  resetJoin()
  void router.push({ name: 'account' })
}
</script>

<style scoped>
.done__para {
  margin: 0;
  line-height: var(--leading-relaxed);
}

.done__steps {
  margin: 0 0 var(--space-5);
  padding: 0;
  list-style: none;
  counter-reset: done-step;
}

.done__step {
  counter-increment: done-step;
  border-left: 2px solid var(--g-line-hi);
  padding: 0 0 0 var(--space-4);
  margin-bottom: var(--space-5);
}

.done__what {
  margin: 0 0 var(--space-1);
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: var(--tracking-ui);
  text-transform: uppercase;
  color: var(--accent-text);
}

.done__what::before {
  content: counter(done-step) '. ';
  color: var(--g-ink-3);
}

.done__how {
  margin: 0;
  max-width: 60ch;
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  color: var(--g-ink-2);
}
</style>
