<script setup lang="ts">
/**
 * *Prijem robe* — one delivery note, and the way into the ones already booked.
 *
 * **One screen, one job.** It used to be a segmented control with two forms
 * behind it — *Ručno* and *Sa slike* — over a period-filtered table of every
 * delivery ever booked, which made a screen whose purpose is *enter what
 * arrived* mostly about things that had already arrived. Now the page is the
 * document being written (`RobaPrijemDoc`), the photo is a way to start that
 * document rather than a rival to it, and the archive is one small button away
 * on `/admin/roba/prijem/historija`.
 *
 * **Nothing about the ledger changed.** Both paths post the same
 * `POST /api/stock/deliveries`, which writes one `stock_movements` row per line
 * inside its own transaction and recomputes the moving average — so a concluded
 * document is on *Stanje šanka* the moment it is concluded, with no second step
 * and nothing deferred.
 *
 * **The venue with no key is a supported venue.** `RobaScanCard` answers a
 * `503 SCAN_NOT_CONFIGURED` by emitting `fallback`; the calm card stays on
 * screen saying so and the typed document opens underneath it, rather than the
 * screen bouncing back to a state that does not explain itself.
 */
import type { StockItemAdmin } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — prijem robe' })

const api = useAdminApi()

/**
 * Which way in. The typed document is the default because it is the one that
 * always works; the photo is one tap away on the document's own head, and the
 * page remembers nothing between visits — a delivery is a decision, not a
 * preference.
 */
const mode = ref<'unos' | 'slika'>('unos')

/**
 * Set when `POST /api/stock/deliveries/scan` answered `503
 * SCAN_NOT_CONFIGURED`. The venue has no key; the document opens beneath the
 * calm card and the page does not ask again.
 */
const scanOff = ref(false)

const items = ref<StockItemAdmin[]>([])
const error = ref('')

async function loadCatalogue() {
  try {
    items.value = await api.getStockItems()
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

onMounted(() => { void loadCatalogue() })

/**
 * A booked delivery moves the shelf, and the catalogue's costs with it. The
 * screen has nothing of its own to refetch — the document clears itself and the
 * history is a page away — so this only keeps the article list honest.
 */
useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock') void loadCatalogue() },
})
</script>

<template>
  <div class="a-page">
    <RobaTabs sub="prijem robe · šta je stiglo na policu">
      <template #actions>
        <UiButton small variant="ghost" @click="navigateTo('/admin/roba/prijem/historija')">
          Historija
        </UiButton>
      </template>
    </RobaTabs>

    <p v-if="error" class="a-error">{{ error }}</p>

    <!-- The way out of the photo, when the photo is not the way in after all.
         Not a segmented control: the two are not peers, they are a document and
         a way to start one, and `UiPageHead`'s *Nazad* belongs to the page. -->
    <UiButton
      v-if="mode === 'slika' && !scanOff"
      small
      variant="ghost"
      class="a-back-to-doc"
      @click="mode = 'unos'"
    >Unesi ručno</UiButton>

    <RobaScanCard
      v-if="mode === 'slika'"
      :items="items"
      @posted="loadCatalogue"
      @catalogue="loadCatalogue"
      @fallback="scanOff = true"
    />

    <RobaPrijemDoc
      v-if="mode === 'unos' || scanOff"
      :items="items"
      @posted="loadCatalogue"
      @scan="mode = 'slika'"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }

/* Its own width, left-aligned: a way back stretched across a phone reads as the
   thing the screen is for, and it never is. */
.a-back-to-doc { align-self: flex-start; margin-bottom: -4px; }
</style>
