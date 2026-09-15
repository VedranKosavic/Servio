<script setup lang="ts">
/**
 * The avatar picker — `/admin`, light kit. **Two clicks per person, and it stays
 * open** until the shift is full or the owner says *Gotovo*.
 *
 * A shift holds at most two people, so a second name is one more click. Once the
 * cell has two, every name is disabled and the sheet says why — the server would
 * refuse a third (`409 SHIFT_FULL`).
 *
 * People already on another shift that weekday are **tagged, not hidden**
 * ("Prva smjena"): the owner may mean a double shift, and hiding the name would
 * hide the decision.
 */
import type { UserAdmin } from '#shared/types'

const props = defineProps<{
  open: boolean
  title: string
  people: UserAdmin[]
  /** user_id → the shift he already works that weekday, for the tag. */
  busy: Map<string, string>
  /** Names already in this cell: the row is disabled, nothing to add. */
  taken: Set<string>
  /** The cell is at its cap: nobody else can be added. */
  full?: boolean
  pendingId?: string | null
  /** The Bosnian sentence from the last refused pick, under the list. */
  error?: string | null
  /** Names the last pick did land, so the owner sees what he has done. */
  done?: string[]
}>()

const emit = defineEmits<{ close: [], pick: [userId: string] }>()

const initials = (person: UserAdmin) => person.initials || person.name.slice(0, 2)

const roleBs = (person: UserAdmin) =>
  (person.role === 'admin' ? 'vlasnik' : 'radnik')

const anyone = computed(() => props.people.length > 0)
</script>

<template>
  <UiSheet :open="open" :title="title" @close="emit('close')">
    <div class="r-pick">
      <p v-if="!anyone" class="r-empty">Nema aktivnog osoblja.</p>
      <p v-else-if="full" class="r-full">U ovoj smjeni su već dvije osobe.</p>

      <button
        v-for="person in people"
        :key="person.id"
        type="button"
        class="r-person"
        :class="{ done: done?.includes(person.id) }"
        :disabled="full || taken.has(person.id) || pendingId === person.id"
        @click="emit('pick', person.id)"
      >
        <span class="r-av" aria-hidden="true">{{ initials(person) }}</span>
        <span class="r-who">
          <span class="r-name">{{ person.name }}</span>
          <small>{{ roleBs(person) }}</small>
        </span>

        <UiPill v-if="done?.includes(person.id)" tone="good">dodan</UiPill>
        <UiPill v-else-if="taken.has(person.id)" tone="neutral">već u smjeni</UiPill>
        <UiPill v-else-if="busy.get(person.id)" tone="warn">{{ busy.get(person.id) }}</UiPill>
      </button>

      <p v-if="error" class="r-error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <UiButton variant="primary" @click="emit('close')">Gotovo</UiButton>
    </template>
  </UiSheet>
</template>

<style scoped>
.r-pick { display: flex; flex-direction: column; gap: 6px; min-width: 0; }

.r-person {
  display: flex;
  align-items: center;
  gap: 10px;
  /* 44 px is the phone floor for every target on `/admin`; the picker is used on
     the phone at least as often as on the laptop. */
  min-height: 48px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--surface);
  font: inherit;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.r-person:disabled { opacity: 0.5; cursor: default; }
.r-person.done { border-color: var(--good); opacity: 1; }

.r-av {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 17px;
  background: var(--surface-2);
  color: var(--ink-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-micro);
  font-weight: 700;
}

.r-who { display: flex; flex-direction: column; min-width: 0; flex-grow: 1; }
.r-name { font-weight: 600; }
.r-who small { color: var(--muted); font-size: var(--text-caption); }

.r-empty { margin: 0; color: var(--muted); }
.r-full { margin: 0 0 4px; color: var(--ink-2); font-weight: 500; }
.r-error { margin: 4px 0 0; color: var(--danger); font-weight: 500; }
</style>
