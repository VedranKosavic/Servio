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
import type { CategoryAdmin, StockItemAdmin } from '#shared/types'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — prijem robe' })

const api = useAdminApi()

const items = ref<StockItemAdmin[]>([])
const categories = ref<CategoryAdmin[]>([])
const error = ref('')

async function loadCatalogue() {
  try {
    // The categories too: a new article is created from this screen, and it
    // goes into one of the same categories *Stanje šanka* and *Meni* use.
    const [stock, cats] = await Promise.all([api.getStockItems(), api.getAdminCategories()])
    items.value = stock
    categories.value = cats
    error.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

onMounted(() => { void loadCatalogue() })

/** *Pregled narudžbi* below, redrawn the moment *Proknjiži* answers — not on the next poll. */
const pregled = ref<{ load: () => Promise<void> } | null>(null)

function onPosted() {
  void loadCatalogue()
  void pregled.value?.load()
}

/**
 * A booked delivery moves the shelf, and the catalogue's costs with it. The
 * screen has nothing of its own to refetch — the document clears itself and the
 * history is a page away — so this only keeps the article list honest.
 */
useAdminChanges({
  onEntity: (entity) => { if (entity === 'stock' || entity === 'menu') void loadCatalogue() },
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
      :categories="categories"
      @posted="onPosted"
      @catalogue="loadCatalogue"
    />

    <!-- When goods were ordered, what came and what it cost. -->
    <RobaPrijemPregled ref="pregled" :items="items" />
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: var(--text-label); }
</style>
