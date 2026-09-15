<script setup lang="ts">
/**
 * *Prijem robe* — one delivery note, and the way into the ones already booked.
 *
 * **One screen, one job.** The page is the document being written
 * (`RobaPrijemDoc`) and nothing else; the archive is one small button away on
 * `/admin/roba/prijem/historija`.
 *
 * **There is no *Sa slike* any more, on the owner's call.** The photo was a
 * second way to start the document; the admins type every delivery by hand, in
 * pieces, so the button and the photo mode are gone from the UI. The server's
 * scan routes are untouched — nothing in the app calls them now.
 *
 * **Nothing about the ledger changed.** The document posts
 * `POST /api/stock/deliveries`, which writes one `stock_movements` row per line
 * inside its own transaction and recomputes the moving average — so a concluded
 * document is on *Stanje šanka* the moment it is concluded, with no second step
 * and nothing deferred.
 */
import type { StockItemAdmin } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — prijem robe' })

const api = useAdminApi()

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

    <RobaPrijemDoc
      :items="items"
      @posted="loadCatalogue"
      @catalogue="loadCatalogue"
    />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
</style>
