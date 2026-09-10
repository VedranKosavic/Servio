<script setup lang="ts">
/**
 * The published rules, drawn.
 *
 * **No `v-html` anywhere.** `markdownish()` gives back plain objects and this
 * template interpolates their text with `{{ }}`, which Vue escapes by
 * construction — so the one document in the app that one person types and
 * everybody else's phone renders cannot carry a tag, a script or a link out.
 *
 * It writes **no colour**. `/k` is dark and `/a` is light and the two never
 * share a rule (PHASE4 §1), so everything here inherits its colour from
 * whichever page it sits in and only sets size, weight and rhythm.
 */
import type { Block } from '~/utils/markdownish'

defineProps<{ blocks: Block[] }>()
</script>

<template>
  <div class="doc">
    <template v-for="(block, index) in blocks" :key="index">
      <h2 v-if="block.kind === 'h2'" class="doc-h2">
        <template v-for="(run, i) in block.runs" :key="i">
          <strong v-if="run.bold">{{ run.text }}</strong>
          <template v-else>{{ run.text }}</template>
        </template>
      </h2>

      <h3 v-else-if="block.kind === 'h3'" class="doc-h3">
        <template v-for="(run, i) in block.runs" :key="i">
          <strong v-if="run.bold">{{ run.text }}</strong>
          <template v-else>{{ run.text }}</template>
        </template>
      </h3>

      <ul v-else-if="block.kind === 'ul'" class="doc-ul">
        <li v-for="(item, i) in block.items" :key="i">
          <template v-for="(run, j) in item" :key="j">
            <strong v-if="run.bold">{{ run.text }}</strong>
            <template v-else>{{ run.text }}</template>
          </template>
        </li>
      </ul>

      <p v-else class="doc-p">
        <template v-for="(run, i) in block.runs" :key="i">
          <strong v-if="run.bold">{{ run.text }}</strong>
          <template v-else>{{ run.text }}</template>
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.doc {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: inherit;
  /* A long document wraps; a pasted URL must not push the phone sideways. */
  overflow-wrap: anywhere;
}

.doc-h2 {
  margin: 8px 0 0;
  font-size: 1.15em;
  font-weight: 700;
  line-height: 1.25;
}

.doc-h2:first-child { margin-top: 0; }

.doc-h3 {
  margin: 6px 0 0;
  font-size: 1em;
  font-weight: 700;
}

.doc-p { margin: 0; }

.doc-ul {
  margin: 0;
  /* Tailwind's preflight strips the markers off every `ul`, and a flex `ul`
     loses them a second time — a flex item has no marker box. A rules document
     is one of the few places that actually wants bullets, so: plain blocks. */
  list-style: disc outside;
  padding-left: 1.2em;
}

.doc-ul li + li { margin-top: 6px; }
</style>
