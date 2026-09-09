<script setup lang="ts">
/**
 * *Otpis* — writing off what broke, spoiled or was poured away.
 *
 * An otpis is a movement like any other: it goes **on** the ledger, it never
 * edits a number. Above the owner's threshold it comes back `needs_approval`,
 * and the approval is an acknowledgement rather than a gate — the stock has
 * already left the shelf either way, and pretending otherwise would teach the
 * bar to stop writing breakages down.
 *
 * There is no list route for waste, and that is not a gap: every otpis writes a
 * `waste_logged` entry, so its history is the *Dnevnik*. This page is the form
 * plus what it has booked in this sitting.
 */
import type { WasteReason } from '#shared/schemas'
import type { StockItemAdmin, WasteView } from '#shared/types'
import type { UiColumn } from '~/components/ui/UiTable.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: 'Roba — otpis' })

const api = useAdminApi()

const items = ref<StockItemAdmin[]>([])
const booked = ref<WasteView[]>([])
const error = ref('')
const sending = ref(false)
const approving = ref<string | null>(null)

const form = reactive({
  stock_item_id: '',
  qty: null as number | null,
  reason: 'razbijeno' as WasteReason,
  note: '',
})

/**
 * The Bosnian word for each reason, in the order the bar uses them.
 *
 * Typed as a `Record<WasteReason, string>` and not imported from the schema:
 * the record is a compile error the day a reason is added, and the type import
 * keeps zod out of the browser bundle.
 */
const REASON_LABELS: Record<WasteReason, string> = {
  razbijeno: 'Razbijeno',
  isteklo: 'Isteklo',
  prosuto: 'Prosuto',
  degustacija: 'Degustacija',
  ostalo: 'Ostalo',
}

const reasonOptions = (Object.keys(REASON_LABELS) as WasteReason[])
  .map(reason => ({ value: reason, label: REASON_LABELS[reason] }))

const itemOptions = computed(() => items.value
  .filter(item => item.active)
  .map(item => ({ value: item.id, label: item.name })))

const selected = computed(() => items.value.find(item => item.id === form.stock_item_id))

async function loadCatalogue() {
  try {
    items.value = await api.getStockItems()
    form.stock_item_id ||= items.value.find(item => item.active)?.id ?? ''
  } catch (err) {
    error.value = apiErrorText(err)
  }
}

onMounted(() => { void loadCatalogue() })

const canSend = computed(() =>
  form.stock_item_id.length > 0 && (form.qty ?? 0) > 0)

async function send() {
  if (!canSend.value || sending.value) return
  sending.value = true
  error.value = ''
  try {
    const saved = await api.postWaste({
      // The replay key: a retry after a lost answer returns the stored otpis
      // instead of taking the bottle off the shelf a second time.
      client_id: crypto.randomUUID(),
      stock_item_id: form.stock_item_id,
      qty: form.qty!,
      reason: form.reason,
      note: form.note.trim() || undefined,
    })
    booked.value = [saved, ...booked.value]
    form.qty = null
    form.note = ''
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}

async function approve(waste: WasteView) {
  approving.value = waste.id
  try {
    await api.approveWaste(waste.id)
    booked.value = booked.value.map(row =>
      row.id === waste.id ? { ...row, needs_approval: false } : row)
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    approving.value = null
  }
}

const COLUMNS: UiColumn[] = [
  { key: 'when', label: 'Kada' },
  { key: 'item', label: 'Artikal' },
  { key: 'qty', label: 'Količina', align: 'r' },
  { key: 'reason', label: 'Razlog' },
  { key: 'cost', label: 'Vrijednost', align: 'r' },
  { key: 'left', label: 'Na stanju', align: 'r' },
  { key: 'status', label: 'Status' },
]
</script>

<template>
  <div class="a-page">
    <RobaTabs sub="otpis · šta je otišlo sa police, a nije prodano" />

    <p v-if="error" class="a-error">{{ error }}</p>

    <UiCard title="Novi otpis">
      <div class="a-fields">
        <UiField v-model="form.stock_item_id" label="Roba" kind="select" :options="itemOptions" />
        <UiField
          v-model="form.qty"
          label="Količina"
          kind="decimal"
          :hint="selected ? `u ${selected.base_unit} · na stanju se odmah smanjuje` : ''"
        />
        <UiField v-model="form.reason" label="Razlog" kind="select" :options="reasonOptions" />
        <UiField v-model="form.note" label="Napomena" placeholder="Neobavezno" />
      </div>

      <p class="a-muted">
        Otpis se upisuje u dnevnik pod imenom onoga ko ga knjiži. Iznad praga koji
        je vlasnik postavio, traži potvrdu — potvrda je priznanica, ne dozvola.
      </p>

      <div class="a-foot">
        <UiButton variant="primary" :disabled="!canSend" :pending="sending" @click="send">
          Proknjiži otpis
        </UiButton>
      </div>
    </UiCard>

    <UiCard v-if="booked.length > 0" title="Proknjiženo u ovoj sjednici" :count="`${booked.length}`">
      <UiTable :columns="COLUMNS">
        <tr v-for="waste in booked" :key="waste.id">
          <td class="a-nowrap">{{ dateTimeBs(waste.created_at) }}</td>
          <td>{{ waste.item_name }}</td>
          <td class="r">{{ waste.qty }}</td>
          <td>{{ REASON_LABELS[waste.reason as WasteReason] ?? waste.reason }}</td>
          <td class="r">
            <UiMoney :fen="waste.cost_fen" :currency="false" />
            <small v-if="waste.estimated" class="a-est">procijenjeno</small>
          </td>
          <td class="r">{{ waste.on_hand }}</td>
          <td>
            <div class="a-status">
              <UiPill :tone="waste.needs_approval ? 'warn' : 'good'">
                {{ waste.needs_approval ? 'čeka potvrdu' : 'proknjiženo' }}
              </UiPill>
              <UiButton
                v-if="waste.needs_approval"
                small
                variant="soft"
                :pending="approving === waste.id"
                @click="approve(waste)"
              >Odobri</UiButton>
            </div>
          </td>
        </tr>
      </UiTable>
    </UiCard>

    <UiCard v-else title="Historija otpisa">
      <p class="a-muted">
        Svaki otpis piše red u Dnevnik — tamo je cijela historija, po danu i po
        osobi. Ovdje ostaje samo ono što proknjižiš sada.
      </p>
      <div class="a-foot">
        <UiButton variant="soft" @click="navigateTo('/a/dnevnik')">Otvori Dnevnik</UiButton>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.a-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-nowrap { white-space: nowrap; }
.a-est { display: block; font-size: 12px; color: var(--muted); }

.a-fields { display: grid; grid-template-columns: 2fr 1fr 1fr 2fr; gap: 12px; }
.a-foot { display: flex; justify-content: flex-end; }
.a-status { display: flex; align-items: center; gap: 8px; }

@media (max-width: 1023px) {
  .a-fields { grid-template-columns: 1fr; }
  .a-foot > .a-btn { flex-grow: 1; }
}
</style>
