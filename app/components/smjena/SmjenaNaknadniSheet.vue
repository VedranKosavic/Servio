<script setup lang="ts">
/**
 * *Naknadni troškovi* — what was paid out of this shift's takings after the
 * šanker closed it (the owner, 17.09.2026). Admins only: the page is `/admin`.
 *
 * Pick the kind — every cost the app already knows, *Ostalo* with its own name —
 * type the amount, *Dodaj*. The answer is the shift's closing again, so *Kasa*
 * and *Predano* redraw from the server's number: *Za predati* of **this** shift,
 * less these, and no other shift or month is touched.
 */
import { formatKm } from '#shared/money'
import { SHIFT_COST_KINDS, SHIFT_COST_LABELS, shiftCostText, type ShiftCostKind } from '#shared/shiftCosts'
import type { ShiftClosing } from '#shared/types'

const props = defineProps<{
  open: boolean
  shiftId: string
  closing: ShiftClosing
}>()

const emit = defineEmits<{ close: [], saved: [closing: ShiftClosing] }>()

const api = useAdminApi()

const kind = ref<string | number | null>('roba')
const label = ref<string | number | null>('')
const amount = ref<string | number | null>(null)
const pending = ref(false)
const removing = ref<string | null>(null)
const error = ref('')
/** One id per opening: a retried tap is the same cost, not a second one. */
const clientId = ref(crypto.randomUUID())

watch(() => props.open, (open) => {
  if (!open) return
  kind.value = 'roba'
  label.value = ''
  amount.value = null
  error.value = ''
  clientId.value = crypto.randomUUID()
})

const kindOptions = SHIFT_COST_KINDS.map(value => ({ value, label: SHIFT_COST_LABELS[value] }))
const isOstalo = computed(() => kind.value === 'ostalo')

async function add() {
  const fen = typeof amount.value === 'number' ? amount.value : null
  const name = String(label.value ?? '').trim()
  if (fen === null || fen <= 0) {
    error.value = 'Upiši iznos, npr. 20'
    return
  }
  if (isOstalo.value && name === '') {
    error.value = 'Za „Ostalo“ upiši naziv troška.'
    return
  }
  pending.value = true
  error.value = ''
  try {
    const closing = await api.addShiftExtraCost(props.shiftId, {
      client_id: clientId.value,
      kind: kind.value as ShiftCostKind,
      ...(isOstalo.value ? { label: name } : {}),
      amount_fen: fen,
    })
    emit('saved', closing)
    // Ready for the next one without closing the sheet.
    clientId.value = crypto.randomUUID()
    amount.value = null
    label.value = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    pending.value = false
  }
}

async function remove(costId: string) {
  removing.value = costId
  error.value = ''
  try {
    emit('saved', await api.deleteShiftExtraCost(props.shiftId, costId))
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <UiSheet :open="open" title="Naknadni troškovi" @close="emit('close')">
    <p class="n-note">
      Plaćeno iz pazara ove smjene nakon zaključenja. Oduzima se samo od ove smjene.
    </p>

    <ul v-if="closing.naknadni.length" class="n-list">
      <li v-for="cost in closing.naknadni" :key="cost.id" class="n-row">
        <span class="n-text">
          <strong>{{ shiftCostText(cost) }}</strong>
          <small>{{ cost.created_by_name }}</small>
        </span>
        <span class="n-right">
          <span class="num">{{ formatKm(cost.amount_fen) }}</span>
          <UiButton small variant="ghost" :disabled="removing === cost.id" @click="remove(cost.id)">
            Ukloni
          </UiButton>
        </span>
      </li>
    </ul>

    <UiField v-model="kind" label="Vrsta troška" kind="select" :options="kindOptions" />
    <UiField v-if="isOstalo" v-model="label" label="Naziv" placeholder="npr. popravka aparata" />
    <UiField v-model="amount" label="Iznos (KM)" kind="money" placeholder="npr. 20" :error="error" />

    <p class="n-sum">
      Za predati: <strong class="num">{{ formatKm(closing.za_predati_fen) }}</strong>
      <template v-if="closing.naknadni_fen > 0">
        (šanker predao {{ formatKm(closing.za_predati_at_close_fen) }})
      </template>
    </p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Gotovo</UiButton>
      <UiButton variant="primary" :pending="pending" @click="add">Dodaj</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.n-note { margin: 0; color: var(--muted); font-size: var(--text-label); }
.n-list { list-style: none; margin: 0; padding: 0; }
.n-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--line-soft);
}
.n-text { display: flex; flex-direction: column; min-width: 0; }
.n-text small { color: var(--muted); font-size: var(--text-label); }
.n-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.n-sum { margin: 0; color: var(--ink-2); font-size: var(--text-label); }
</style>
