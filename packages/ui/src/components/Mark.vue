<template>
  <!--
    The source is one of the 29 mark files in this package, imported at build
    time and indexed by a union type, so it can only ever be our own SVG. No
    caller-supplied string reaches it. Inlining rather than using an img tag is
    what lets a mark inherit its colour from currentColor.
  -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span class="mark" aria-hidden="true" :style="{ height: `${height}px` }" v-html="source" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { markSources, type MarkName } from '../marks'

interface Props {
  name: MarkName
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 26,
})

const source = computed(() => markSources[props.name])
</script>

<style scoped>
/* Decorative on purpose: every place a mark appears it sits beside the visible
   name of the app or the screen, so announcing it again would repeat the label. */
.mark {
  display: inline-flex;
  flex: none;
  color: inherit;
}

.mark :deep(svg) {
  display: block;
  height: 100%;
  width: auto;
}
</style>
