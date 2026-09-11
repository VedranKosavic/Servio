<script setup lang="ts">
/**
 * A category, new or being edited.
 *
 * `kind` is not decoration: it is what puts a product on the *Nargila* flow
 * instead of the plain one, and what the *Kategorije* report groups nabavka and
 * prodaja by. `note_chips` are the quick notes the waiter taps instead of typing
 * ("bez šećera", "duplo"), entered here one per line.
 *
 * **`sort` is here for the laptop only.** A phone reorders by moving a row in
 * the list, which is a swap of two numbers and therefore cannot be a field on a
 * form with one Save; a laptop has the whole table in front of it and typing a
 * number is a reasonable thing to ask there. Either way the number is still sent
 * — the field is hidden, not dropped — so a phone edit never resets a category's
 * place in the menu.
 */
import type { CategoryAdmin, CategoryKind } from '#shared/types'
import type { CreateCategoryBody, UpdateCategoryBody } from '#shared/schemas'

const props = defineProps<{
  open: boolean
  /** `null` means *Nova kategorija*. */
  category: CategoryAdmin | null
  /** Where a new category goes: one past the last one. */
  nextSort: number
  /** The laptop edits `sort` as a number; the phone moves rows instead. */
  showSort: boolean
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  create: [body: CreateCategoryBody]
  update: [id: string, patch: UpdateCategoryBody]
}>()

const KINDS: Array<{ value: CategoryKind, label: string }> = [
  { value: 'pice', label: 'Piće' },
  { value: 'hrana', label: 'Hrana' },
  { value: 'nargila', label: 'Nargila' },
  { value: 'ostalo', label: 'Ostalo' },
]

const name = ref('')
const kind = ref<CategoryKind>('pice')
const chips = ref('')
const sort = ref<number | null>(0)
const active = ref(true)

watch(() => [props.open, props.category?.id], () => {
  if (!props.open) return
  const category = props.category
  name.value = category?.name ?? ''
  kind.value = category?.kind ?? 'pice'
  chips.value = (category?.note_chips ?? []).join('\n')
  sort.value = category?.sort ?? props.nextSort
  active.value = category?.active ?? true
}, { immediate: true })

/** One chip per line; blank lines are dropped rather than sent as empty chips. */
const chipList = computed(() => chips.value
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0))

const canSave = computed(() => name.value.trim() !== '')

function save() {
  if (!canSave.value) return
  const body = {
    name: name.value.trim(),
    kind: kind.value,
    note_chips: chipList.value,
    sort: sort.value ?? 0,
    active: active.value,
  }
  if (props.category) emit('update', props.category.id, body)
  else emit('create', body)
}
</script>

<template>
  <UiSheet
    :open="open"
    :title="category ? `Kategorija · ${category.name}` : 'Nova kategorija'"
    :pending="pending"
    @close="emit('close')"
  >
    <p v-if="error" class="p-error" role="alert">{{ error }}</p>

    <UiField v-model="name" label="Naziv" placeholder="Bezalkoholna" />

    <UiField
      :model-value="kind"
      label="Vrsta"
      kind="select"
      :options="KINDS"
      @update:model-value="value => kind = value as CategoryKind"
    />

    <UiField
      v-model="chips"
      label="Napomene"
      kind="textarea"
      hint="Jedna po redu. Konobar ih tapne umjesto da kuca."
      placeholder="bez šećera&#10;duplo"
    />

    <PostavkeNumField
      v-if="showSort"
      label="Sortiranje"
      :model-value="sort"
      kind="int"
      hint="Manji broj ide prvi na telefonu."
      @commit="value => sort = value"
    />

    <div class="p-row">
      <span class="p-caption">Aktivna</span>
      <PostavkeToggle v-model="active" label="Aktivna kategorija" words />
    </div>

    <p v-if="category && category.product_count > 0 && !active" class="p-warn">
      {{ category.product_count }} artikala nestaje sa menija dok je kategorija ugašena.
    </p>
      <template #footer>
        <UiButton variant="ghost" @click="emit('close')">Odustani</UiButton>
        <UiButton
          variant="primary"
          :pending="pending"
          :disabled="!canSave"
          @click="save"
        >{{ category ? 'Sačuvaj' : 'Dodaj' }}</UiButton>
      </template>
  </UiSheet>
</template>

<style scoped>
.p-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: var(--text-micro);
}

.p-warn {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: var(--text-micro);
}

.p-row { display: flex; align-items: center; gap: 12px; }

.p-caption {
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}
</style>
