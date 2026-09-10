<script setup lang="ts">
/**
 * *Novi artikal* from an unknown scan line (PHASE4 WP3).
 *
 * The short form of the article sheet: the six fields a delivery actually needs.
 * Everything else — tolerancija, par, tara, kategorija — has a sane default and
 * is edited on *Roba → artikal* afterwards, because the owner is standing at the
 * bar with a delivery note in his hand and a full article form is the wrong
 * thing to put between him and the crates.
 *
 * On save it does two writes: the article, then the alias for the OCR text that
 * had no match — so the **next** photo from this supplier comes back green
 * without anybody doing anything.
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

const name = ref('')
const kind = ref<CreateStockItemBody['kind']>('pice')
const baseUnit = ref<CreateStockItemBody['base_unit']>('kom')
const packName = ref('')
const packQty = ref<number | null>(null)
const sending = ref(false)
const error = ref('')

const KINDS = [
  { value: 'pice', label: 'Piće' },
  { value: 'duhan', label: 'Duhan' },
  { value: 'zar', label: 'Žar' },
  { value: 'potrosni', label: 'Potrošni' },
  { value: 'hrana', label: 'Hrana' },
]

const UNITS = [
  { value: 'kom', label: 'komad' },
  { value: 'g', label: 'gram' },
  { value: 'ml', label: 'mililitar' },
]

watch(() => props.open, (open) => {
  if (!open) return
  name.value = props.text.slice(0, 60)
  kind.value = 'pice'
  baseUnit.value = 'kom'
  packName.value = ''
  packQty.value = null
  error.value = ''
})

const canSave = computed(() => name.value.trim().length > 0 && !sending.value)

async function save() {
  if (!canSave.value) return
  sending.value = true
  error.value = ''
  try {
    const created = await api.createStockItem({
      name: name.value.trim(),
      kind: kind.value,
      base_unit: baseUnit.value,
      brand: null,
      pack_name: packName.value.trim() || null,
      pack_qty: packQty.value ?? null,
    })
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
  <UiSheet :open="open" title="Novi artikal" :pending="sending" @close="emit('close')" @confirm="save">
    <p class="a-muted">Sa otpremnice: „{{ text }}“</p>

    <UiField v-model="name" label="Naziv" placeholder="Npr. Coca-Cola 0,25" />
    <UiField v-model="kind" label="Vrsta" kind="select" :options="KINDS" />
    <UiField v-model="baseUnit" label="Osnovna jedinica" kind="select" :options="UNITS" />
    <UiField v-model="packName" label="Naziv paketa" placeholder="gajba, kutija — neobavezno" />
    <UiField
      v-model="packQty"
      label="Komada u paketu"
      kind="decimal"
      hint="Prazno ako roba ne dolazi u paketu"
    />

    <p class="a-muted">
      Ostalo — kategorija, tolerancija, par — podesi kasnije na Roba → artikal.
      Naziv sa otpremnice se odmah povezuje, pa je sljedeća slika prepoznata.
    </p>

    <p v-if="error" class="a-error">{{ error }}</p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
      <UiButton variant="primary" :disabled="!canSave" :pending="sending" @click="save">
        Sačuvaj i poveži
      </UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
</style>
