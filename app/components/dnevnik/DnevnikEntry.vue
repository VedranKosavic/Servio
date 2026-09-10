<script setup lang="ts">
/**
 * One row of the *Dnevnik*: the time, a 32 px icon tinted by kind, the sentence
 * the server already wrote, and the drill-downs.
 *
 * **The sentence is not composed here.** `title_bs` arrives rendered — with the
 * names looked up and the amounts formatted by the same `formatKm` this screen
 * would use — so the row only splits it into its headline and its tail
 * (`splitTitle`) and draws them. A client that rebuilt the sentence out of the
 * body would be a second place where a Bosnian phrase lives, and the two would
 * drift the first time a template changed.
 *
 * A **decision carries the request it resolved** inline: `listLog` attaches
 * `.request` to any entry whose `resolves_id` points at one, which is what lets
 * the *Važno* filter hide a quiet `void_requested` without losing it — the
 * `void_decided` above it still shows what was asked.
 */
import type { LogEntryDetail } from '#shared/types'
import { lookOf, pillsOf, splitTitle } from './dnevnikKinds'

const props = defineProps<{
  entry: LogEntryDetail
  /** On `/admin/dnevnik/:id` the headline is the page's own; do not link it again. */
  linked?: boolean
}>()

const look = computed(() => lookOf(props.entry.kind))
const title = computed(() => splitTitle(props.entry.title_bs))
const pills = computed(() => pillsOf(props.entry.body))

/**
 * Where a row leads. The Dnevnik is the *what happened*; the numbers behind it
 * live on *Smjena*, so an entry that belongs to a shift offers that night and,
 * when the body names a person, exactly his lines in it.
 *
 * `kat` is a filter the lines route understands — `storno`, `gratis` — and not
 * a category slug; a category is addressed by id there, which the log body does
 * not carry.
 */
const chips = computed(() => {
  const shiftId = props.entry.shift_id
  if (!shiftId) return []

  const body = props.entry.body
  const user = typeof body.user_id === 'string' ? body.user_id : undefined
  const kat = look.value.group === 'storno'
    ? (props.entry.kind.startsWith('comp') ? 'gratis' : 'storno')
    : undefined

  return [
    { label: 'Smjena', to: `/admin/smjena/${shiftId}` },
    {
      label: 'Stavke',
      to: {
        path: `/admin/smjena/${shiftId}/stavke`,
        query: { ...(user ? { user } : {}), ...(kat ? { kat } : {}) },
      },
    },
  ]
})
</script>

<template>
  <article class="d-entry">
    <div class="d-tm">{{ timeBs(entry.at) }}</div>

    <div class="d-ic" :class="`t-${look.tone}`">
      <UiIcon :name="look.icon" :size="20" />
    </div>

    <div class="d-body">
      <div class="d-head">
        <NuxtLink v-if="linked" :to="`/admin/dnevnik/${entry.id}`" class="d-h">{{ title.head }}</NuxtLink>
        <span v-else class="d-h">{{ title.head }}</span>
        <span v-if="title.rest" class="d-rest">{{ title.rest }}</span>
        <UiPill v-for="pill in pills" :key="pill.text" :tone="pill.tone">{{ pill.text }}</UiPill>
        <UiPill v-if="entry.redacted" tone="neutral">redigovano</UiPill>
      </div>

      <p v-if="entry.request" class="d-linked">
        Riješen zahtjev · {{ entry.request.title_bs }} · {{ timeBs(entry.request.at) }}
      </p>

      <p v-if="entry.resolver" class="d-linked">
        <UiIcon name="check" :size="16" />
        Riješio {{ entry.resolver.actor_name ?? 'Sistem' }} · {{ timeBs(entry.resolver.at) }}
      </p>

      <div v-if="chips.length" class="d-chips">
        <NuxtLink v-for="chip in chips" :key="chip.label" :to="chip.to" class="d-chip">
          {{ chip.label }}
        </NuxtLink>
      </div>
    </div>
  </article>
</template>

<style scoped>
.d-entry {
  display: flex;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--surface-2);
}

.d-entry:last-child { border-bottom: 0; }

.d-tm {
  width: 52px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 13px;
  /* Tabular figures: 18:03 and 22:41 have to line up down the column. */
  font-variant-numeric: tabular-nums;
  padding-top: 6px;
}

.d-ic {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.t-accent { background: var(--accent-soft); color: var(--accent-ink); }
.t-good { background: var(--good-soft); color: var(--good); }
.t-bad { background: var(--danger-soft); color: var(--danger); }

.d-body { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

.d-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.d-h { font-weight: 600; color: var(--ink); text-decoration: none; }
.d-h:hover { text-decoration: underline; }
.d-rest { color: var(--muted); min-width: 0; }

.d-linked {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.d-chips { display: flex; flex-wrap: wrap; gap: 6px; }

.d-chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 13px;
  color: var(--ink);
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.d-chip:hover { border-color: var(--accent); color: var(--accent-ink); }

/* Below the breakpoint every target a thumb can hit is at least 44 px. */
@media (max-width: 1023px) {
  .d-entry { gap: 10px; padding: 14px 0; }
  .d-tm { width: 44px; }
  .d-chip { height: 44px; padding: 0 14px; font-size: 14px; }
}
</style>
