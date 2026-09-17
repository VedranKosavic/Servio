<script setup lang="ts">
/**
 * One item on *Dodaj*. A tap anywhere on the tile is +1 — that is the whole
 * interaction, and it has to survive a thumb in a dark room.
 *
 * The "−" only appears once something is on the tile, and it is its own 48 px
 * button sitting on top of the tile rather than inside it: a button inside a
 * button is invalid HTML, so the tile is a button and the minus is a sibling
 * placed over its corner.
 *
 * **There is no long press** (the owner, 17.09.2026: the note on a long press
 * is not needed). A tap is +1 and nothing else; *Na račun kuće* and a line's
 * note are still on the ⋯ of each draft line on the table's screen.
 */
import { formatKm } from '#shared/money'

const props = withDefaults(defineProps<{
  name: string
  /** What fits on a 3-column tile; the full name is the fallback. */
  shortName?: string | null
  priceFen: number
  /** How many are already on the draft round. 0 hides the badge and the "−". */
  qty: number
  /** Nargila: the tap opens the aroma sheet instead of adding straight away. */
  shisha?: boolean
  /**
   * Nothing of it on *Stanje šanka* (16.09.2026): the name and price are struck
   * through, the tile is dimmed and says *nema*, and a tap adds nothing. A long
   * press still opens nothing either.
   */
  unavailable?: boolean
  /** What the struck tile says instead of *nema* — "do 09:00" for a Happy Hour article. */
  offLabel?: string
  /** The picture behind the tile, faded (17.09.2026); `null` draws the tile as before. */
  imageUrl?: string | null
}>(), { shortName: null, shisha: false, unavailable: false, offLabel: undefined, imageUrl: null })

const emit = defineEmits<{ add: [], remove: [] }>()

function onClick() {
  if (props.unavailable) return
  emit('add')
}

const label = computed(() => props.shortName ?? props.name)
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="tile-btn"
      :class="{ 'has-qty': qty > 0, 'tile-off': unavailable }"
      :aria-disabled="unavailable ? 'true' : undefined"
      :aria-label="unavailable ? `${name} — ${offLabel ? `dostupno samo ${offLabel}` : 'nema na stanju'}` : undefined"
      @contextmenu.prevent
      @click="onClick"
    >
      <img v-if="imageUrl" :src="imageUrl" alt="" class="tile-img" loading="lazy" draggable="false">
      <span class="flex w-full items-start justify-between gap-1">
        <span class="tile-name">{{ label }}</span>
        <span v-if="shisha" class="shrink-0 text-accent-text" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5 1-9z" />
          </svg>
        </span>
      </span>
      <!-- An unavailable tile says why ("nema", "do 09:00") where the price was. -->
      <span v-if="!unavailable" class="num tile-price">{{ formatKm(priceFen) }}</span>
      <span v-if="unavailable" class="tile-none">{{ offLabel ?? 'nema' }}</span>
    </button>

    <span v-if="qty > 0" class="num tile-qty">{{ qty }}</span>

    <button
      v-if="qty > 0"
      type="button"
      class="tile-minus"
      :aria-label="`Skini jedan · ${name}`"
      @click.stop="emit('remove')"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 12h12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/** Struck through and dimmed, and still readable: the waiter must see *what* is missing. */
.tile-off {
  opacity: 0.5;
  cursor: not-allowed;
}
.tile-off .tile-name,
.tile-off .tile-price {
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}
.tile-none {
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--danger);
}

/**
 * The tile is a card, not a button-shaped thing: material, an edge, and the two
 * facts a waiter reads out loud — the name at body size and the price under it
 * in tabular figures.
 *
 * The price sits *under the name*, not at the far end of a stretched box.
 * `justify-content: space-between` pushed it to the bottom of whatever height
 * the grid row took from its tallest neighbour — roughly 60 px of nothing
 * between a name and the figure that belongs to it, so six favourites filled
 * the screen and the price a waiter has to check floated away from it. The
 * content packs at the top now and the 8 px gap does the spacing.
 *
 * The " KM" stays. `FloorPlan` drops the currency because every tile on it is
 * an amount and the unit is obvious from the column; here the price is the only
 * number on the tile, and the `/konobar` end-to-end specs identify a product
 * tile by it — a cosmetic edit is not a reason to loosen a guardrail locator.
 */
.tile-btn {
  display: flex;
  width: 100%;
  /* Every tile the same square, whatever its name (the owner, 17.09.2026):
     with a picture behind it, a tile two lines taller read as a bigger picture. */
  aspect-ratio: 1 / 1;
  overflow: hidden;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px;
  text-align: left;
  user-select: none;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-standard),
    transform var(--dur-tap) var(--ease-standard);
}

.tile-btn:active { transform: scale(0.97); background: var(--surface-2); }

/* The picture fills the tile behind the name and price, faded so the two facts
   the waiter reads stay legible (the owner, 17.09.2026). The tile keeps its size. */
.tile-btn { position: relative; }
.tile-btn:has(.tile-img) { isolation: isolate; }
.tile-img {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.3;
  pointer-events: none;
}

.tile-name {
  /* 15 px, not the body's 16: "Cappuccino" fits a 108 px square on one line. */
  font-size: 15px;
  line-height: 1.2;
  font-weight: 600;
  color: var(--ink);
  /* Three lines at most, so a long name cannot push the price out of the square. */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* A word is split with a hyphen (Bosnian rules), never cut mid-letter. */
  hyphens: auto;
  overflow-wrap: normal;
}

.tile-price {
  font-size: var(--text-label);
  font-weight: 500;
  color: var(--ink-2);
}

/* A three-across tile is 111 px wide on a 390 px phone, which is not enough for
   a price *and* a 48 px control on the same line — so the control hangs off the
   corner (below) and the price only has to clear its overhang. */
.tile-btn.has-qty .tile-price {
  padding-right: 26px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* How many are on the round. The one copper thing on the tile. */
.tile-qty {
  position: absolute;
  top: -8px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border-radius: var(--radius-chip);
  border: 2px solid var(--bg);
  background: var(--accent);
  color: var(--on-accent);
  font-size: var(--text-label);
  font-weight: 700;
}

/**
 * "−" is its own 48 px target sitting *on* the tile rather than inside it: a
 * button inside a button is invalid HTML, so the tile is a button and the minus
 * is a sibling placed over its corner. It only exists once something is on the
 * tile.
 */
.tile-minus {
  position: absolute;
  right: -6px;
  bottom: -6px;
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-chip);
  border: 2px solid var(--bg);
  background: var(--surface-3);
  color: var(--ink);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}

.tile-minus:active { background: var(--line); }
</style>
