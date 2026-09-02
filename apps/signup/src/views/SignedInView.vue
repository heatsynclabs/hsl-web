<template>
  <section class="signed-in">
    <Card eyebrow="Already a member" title="You are signed in">
      <p class="signed-in__para">
        This browser is signed in as {{ who }}, so there is nothing to join. The API refuses a
        second account for an email address that already has one.
      </p>
      <p class="signed-in__para">
        If you are helping somebody else join, sign out in the members app first and come back.
      </p>
      <Link href="/">Open the members app</Link>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { useSession } from '@hsl/api-client'
import { Card, Link } from '@hsl/ui'
import { computed } from 'vue'

const who = computed(() => useSession().member?.name ?? 'a member')
</script>

<style scoped>
.signed-in {
  max-width: 620px;
}

.signed-in__para {
  margin: 0 0 var(--space-4);
  line-height: var(--leading-relaxed);
}
</style>
