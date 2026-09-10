<script setup lang="ts">
/**
 * *Poveži* — teach the venue that this supplier's wording means this article.
 *
 * `POST /api/stock/supplier-aliases` stores the text folded (lowercased,
 * diacritics stripped, punctuation collapsed), so "Coca Cola 0,25" and
 * "coca-cola 0.25" collide on purpose and the **second** photo from the same
 * supplier comes back green at confidence 1,0 without the model being asked
 * twice.
 *
 * The search is a plain filter over the catalogue already in memory — the whole
 * list is a few hundred rows and it is loaded before the page paints.
 */
import type { StockItemAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  /** The OCR text to learn. */
  text: string
  supplier: string | null
  items: StockItemAdmin[]
}>()

const emit = defineEmits<{ close: [], linked: [id: string] }>()

const api = useAdminApi()

const query = ref('')
const picked = ref('')
const sending = ref(false)
const error = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  // Start from the OCR text — half the time the supplier writes the name we use.
  // But only if it actually finds something: a prefilled word that matches
  // nothing would open the sheet on an empty list, which reads as "we have no
  // articles" rather than "try another word".
  const guess = props.text.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/)[0] ?? ''
  query.value = matches(guess).length > 0 ? guess : ''
  picked.value = ''
  error.value = ''
})

function matches(needle: string) {
  const text = needle.trim().toLowerCase()
  return props.items
    .filter(item => item.active)
    .filter(item => text.length === 0
      || item.name.toLowerCase().includes(text)
      || (item.brand ?? '').toLowerCase().includes(text))
}

const found = computed(() => matches(query.value).slice(0, 40))

async function save() {
  if (!picked.value || sending.value) return
  sending.value = true
  error.value = ''
  try {
    await api.linkSupplierAlias({
      alias: props.text,
      stock_item_id: picked.value,
      ...(props.supplier ? { supplier_name: props.supplier } : {}),
    })
    emit('linked', picked.value)
  } catch (err) {
    error.value = apiErrorText(err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UiSheet :open="open" title="Poveži sa artiklom" :pending="sending" @close="emit('close')" @confirm="save">
    <p class="a-muted">Sa otpremnice: „{{ text }}“</p>

    <UiField v-model="query" label="Traži robu" placeholder="Npr. cola" />

    <ul class="a-hits">
      <li v-for="item in found" :key="item.id">
        <button
          type="button"
          class="a-hit"
          :class="{ on: picked === item.id }"
          :aria-pressed="picked === item.id"
          @click="picked = item.id"
        >
          <span class="a-hit-name">{{ item.name }}</span>
          <span class="a-hit-meta">
            {{ item.pack_qty ? `${item.pack_name} × ${item.pack_qty}` : item.base_unit }}
          </span>
        </button>
      </li>
    </ul>

    <p v-if="found.length === 0" class="a-muted">Nema artikla s tim nazivom.</p>

    <p class="a-muted">
      Nakon povezivanja sljedeća slika od ovog dobavljača prepoznaje ovaj red sama.
    </p>

    <p v-if="error" class="a-error">{{ error }}</p>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
      <UiButton variant="primary" :disabled="!picked" :pending="sending" @click="save">Poveži</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.a-muted { margin: 0; color: var(--muted); font-size: 13px; }
.a-error { margin: 0; color: var(--danger); font-size: 14px; }

.a-hits {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}

.a-hit {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.a-hit.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.a-hit-name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.a-hit-meta { margin-left: auto; font-size: 12px; color: var(--muted); white-space: nowrap; }
</style>
