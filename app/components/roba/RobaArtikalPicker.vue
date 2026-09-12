<script setup lang="ts">
/**
 * *Izaberi artikal* — the one control *Prijem robe* is used through.
 *
 * **It replaces a bare `<select>`.** On a phone that select opened the operating
 * system's own wheel of nineteen names in one undifferentiated column, with no
 * search, no grouping, no unit beside a name and no way to tell *Al Fakher ·
 * Limun-menta* from *Al Fakher · Lubenica* except by reading both to the end.
 * The owner's screenshot is exactly that. It is also the control he touches most
 * on the screen — every line of every delivery note starts here — so it is worth
 * being a real sheet.
 *
 * What it is instead: a search field, then the same three sections *Stanje
 * šanka* draws — *Kafa*, *Nargila*, *Ostalo* (`stanjeGroup()` in
 * `RobaStanjeTable.vue`, so the two screens can never disagree about where an
 * article belongs) — each a sticky label over a card of 44 px rows. A row says
 * the name and, quietly beside it, the unit and the crate: *kom · gajba = 24
 * kom* is the sentence somebody needs one field later, when he types how much
 * arrived. The chosen article carries a check.
 *
 * **The search matches per word, by prefix, without diacritics.** "cola" finds
 * *Coca-Cola 0,25 l*, "menta" finds both mints, "secer" would find *Šećer* — a
 * thumb at 23:40 types no caron. It is the same rule and the same `fold()` the
 * waiter's *Dodaj* screen searches by, imported rather than written again.
 *
 * One tap picks and closes: there is no *Sačuvaj* in a sheet whose whole job is
 * one choice, and the quantity field behind it is where the owner is going next.
 */
import { fold } from '~/components/order/OrderText'
import { stanjeGroup } from './RobaStanjeTable.vue'
import type { StockItemAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  /** The catalogue — `GET /api/admin/stock-items`. Inactive rows are dropped. */
  items: StockItemAdmin[]
  /** The article the document's adder is holding, so the sheet can mark it. */
  selectedId: string
}>()

const emit = defineEmits<{ close: [], pick: [id: string] }>()

const query = ref('')

// Every opening starts from the whole shelf: a query left over from the last
// line is a list that silently hides the article somebody came for.
watch(() => props.open, (open) => { if (open) query.value = '' })

const active = computed(() => props.items.filter(item => item.active))

/** Does this article match what has been typed? Per word, by prefix (see above). */
function matches(item: StockItemAdmin, needle: string): boolean {
  if (needle === '') return true
  const haystack = fold(`${item.name} ${item.brand ?? ''} ${item.pack_name ?? ''}`)
  return haystack.split(/[\s·,\-/()]+/).some(word => word.startsWith(needle))
}

/** The sections, in the shelf's own order, with the empty ones dropped. */
const sections = computed(() => {
  const needle = fold(query.value).trim()
  const hits = active.value.filter(item => matches(item, needle))
  return ([
    { key: 'kafa', label: 'Kafa' },
    { key: 'nargila', label: 'Nargila' },
    { key: 'ostalo', label: 'Ostalo' },
  ] as const)
    .map(group => ({
      ...group,
      rows: hits.filter(item => stanjeGroup(item) === group.key),
    }))
    .filter(section => section.rows.length > 0)
})

const found = computed(() => sections.value.reduce((n, section) => n + section.rows.length, 0))

/** "kom · gajba = 24 kom" — the unit, and the crate for anybody multiplying. */
function meta(item: StockItemAdmin): string {
  const pack = item.pack_qty && item.pack_name
    ? ` · ${item.pack_name} = ${item.pack_qty} ${item.base_unit}`
    : ''
  return `${item.base_unit}${pack}`
}
</script>

<template>
  <UiSheet :open="open" title="Izaberi artikal" @close="emit('close')">
    <UiField
      v-model="query"
      label="Traži artikal"
      placeholder="Npr. cola"
      :hint="query.trim() ? `${found} od ${active.length}` : undefined"
    />

    <div class="p-groups">
      <section v-for="section in sections" :key="section.key" class="p-group">
        <h3 class="p-group-head">
          <span>{{ section.label }}</span>
          <span class="p-group-n num">{{ section.rows.length }}</span>
        </h3>

        <div class="p-card">
          <button
            v-for="item in section.rows"
            :key="item.id"
            type="button"
            class="p-row"
            :class="{ on: item.id === selectedId }"
            :aria-pressed="item.id === selectedId"
            @click="emit('pick', item.id)"
          >
            <span class="p-text">
              <span class="p-name">{{ item.name }}</span>
              <span class="p-meta num">{{ meta(item) }}</span>
            </span>
            <UiIcon v-if="item.id === selectedId" name="check" :size="18" class="p-check" />
          </button>
        </div>
      </section>
    </div>

    <p v-if="sections.length === 0" class="p-empty">Nema artikla s tim nazivom.</p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.p-groups { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.p-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

/* The label holds the top of the scroller while its own articles are under it,
   so a thumb halfway down nineteen rows still knows which part of the shelf it
   is in. It sits on the sheet's own material, opaque, so the card passes
   cleanly underneath. */
.p-group-head {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 2px 5px;
  background: var(--surface);
  font-size: var(--text-label);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.p-group-n { font-weight: 500; }

.p-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
  min-width: 0;
}

.p-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--tap);
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--line-soft);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.p-row:last-child { border-bottom: 0; }
.p-row:hover { background: var(--bg); }
.p-row:active { background: var(--bg); }
.p-row:focus-visible { outline: 2px solid var(--accent-text); outline-offset: -2px; }

/* The article already on the adder. Copper as a tint and as ink, never as a
   fill: the fill is reserved for the one primary action (DESIGN §2). */
.p-row.on { background: var(--accent-soft); }
.p-row.on .p-name { color: var(--accent-text); }
.p-check { color: var(--accent-text); flex-shrink: 0; margin-left: auto; }

.p-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.p-name {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.p-meta { font-size: var(--text-micro); color: var(--muted); }

.p-empty {
  margin: 0;
  padding: 18px 14px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-card);
  color: var(--muted);
  font-size: var(--text-label);
  text-align: center;
}
</style>
