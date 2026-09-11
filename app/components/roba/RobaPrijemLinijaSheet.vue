<script setup lang="ts">
/**
 * One line of a delivery note being built — correct it, or take it off.
 *
 * The line on the card is three pieces of text and no controls, because it is
 * read far more often than it is changed: a document is twelve lines and at most
 * one of them is a typo. So the two controls it needs live here, one tap behind
 * the line, which is the same bargain *Meni* makes with its product sheet.
 *
 * The fields are a **local copy**, committed by *Sačuvaj*. A sheet writing
 * straight through to the document would leave a half-typed quantity in the
 * total behind it — and since the total is the number the owner checks against
 * the paper, it has to mean something at every moment.
 */
const props = defineProps<{
  open: boolean
  /** The article's name; the sheet's title and the only thing it cannot change. */
  name: string
  /** `kom`, `g` or `ml` — the unit the quantity is counted in. */
  unitHint: string
  qty: number
  lineCostFen: number
}>()

const emit = defineEmits<{
  close: []
  save: [patch: { qty: number, line_cost_fen: number }]
  remove: []
}>()

const qty = ref<number | null>(props.qty)
const cost = ref<number | null>(props.lineCostFen)

// Re-seeded every time the sheet opens, and on a line replaced under it.
watch(() => [props.open, props.qty, props.lineCostFen], () => {
  if (!props.open) return
  qty.value = props.qty
  cost.value = props.lineCostFen
}, { immediate: true })

const canSave = computed(() => (qty.value ?? 0) > 0 && (cost.value ?? 0) > 0)

function save() {
  if (!canSave.value) return
  emit('save', { qty: qty.value!, line_cost_fen: cost.value! })
}
</script>

<template>
  <UiSheet :open="open" :title="name" @close="emit('close')">
    <UiField v-model="qty" label="Količina" kind="decimal" :hint="unitHint" />
    <UiField v-model="cost" label="Iznos (KM)" kind="money" hint="sa fakture" />

    <template #footer>
      <UiButton variant="danger" @click="emit('remove')">Ukloni</UiButton>
      <UiButton variant="primary" :disabled="!canSave" @click="save">Sačuvaj</UiButton>
    </template>
  </UiSheet>
</template>
