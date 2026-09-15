<script setup lang="ts">
/**
 * *Novi artikal* from an unknown scan line (PHASE4 WP3).
 *
 * The short form of `RobaArtikalSheet` — the fields a delivery actually needs.
 * Everything else — tolerancija, minimalna zaliha, tara, kategorija — has a sane
 * default and is edited on *Kontrolna ploča → Artikli zalihe* afterwards, because
 * the owner is standing at the bar with a delivery note in his hand.
 *
 * On save it does two writes: the article, then the alias for the OCR text that
 * had no match — so the **next** photo from this supplier comes back green
 * without anybody doing anything. The alias is this flow's alone; the typed
 * delivery creates through the same sheet and links nothing.
 */
import type { CreateStockItemBody } from '#shared/schemas'
import type { StockItemAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  /** The OCR text of the unknown line — the name to start from, and the alias to learn. */
  text: string
  supplier: string | null
}>()

const emit = defineEmits<{ close: [], created: [item: StockItemAdmin] }>()

const api = useAdminApi()

const sending = ref(false)
const error = ref('')

watch(() => props.open, (open) => { if (open) error.value = '' })

async function save(body: CreateStockItemBody) {
  if (sending.value) return
  sending.value = true
  error.value = ''
  try {
    const created = await api.createStockItem(body)
    // The alias is the whole point: the article without it would still be a
    // manual pick on the next otpremnica.
    await api.linkSupplierAlias({
      alias: props.text,
      stock_item_id: created.id,
      ...(props.supplier ? { supplier_name: props.supplier } : {}),
    })
    emit('created', created)
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <RobaArtikalSheet
    :open="open"
    :initial-name="text"
    action="Sačuvaj i poveži"
    :pending="sending"
    :error="error || null"
    @close="emit('close')"
    @create="save"
  >
    <template #lead>
      <p class="a-muted">Sa otpremnice: „{{ text }}“</p>
    </template>
    <template #note>
      <p class="a-muted">
        Ostalo — kategorija, tolerancija, minimalna zaliha — podesi kasnije na
        Kontrolna ploča → Artikli zalihe. Naziv sa otpremnice se odmah povezuje,
        pa je sljedeća slika prepoznata.
      </p>
    </template>
  </RobaArtikalSheet>
</template>

<style scoped>
.a-muted { margin: 0; color: var(--muted); font-size: var(--text-micro); }
</style>
