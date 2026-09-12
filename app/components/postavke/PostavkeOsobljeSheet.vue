<script setup lang="ts">
/**
 * Everything one person's account can have done to it, in one place.
 *
 * On a laptop these are two buttons at the end of a row and there is room for
 * them. On a phone the same row had *Izmijeni* and *Novi PIN* competing with
 * the name for 390 px, and the two of them still did not cover the third thing
 * the owner actually does — taking somebody off the staff. So below 1024 px the
 * whole row is one target and its actions live here, one per line, each with
 * the sentence that says what it does.
 *
 * **Two of the three hand over rather than stack.** *Novi PIN* and *Izmijeni*
 * close this sheet and open their own, exactly as *Meni* hands over to the
 * recipe editor: two scrims on a phone is one scrim too many.
 *
 * **Ugasi radnika asks first.** It is not the destructive-looking half of an
 * undoable pair: deactivating also removes the person from every future shift
 * and cancels his live swap requests, and bringing him back does not put those
 * rows back. So it is a second screen in the same sheet — `contentKey` moves
 * focus into it — and the question names what will happen.
 *
 * **A PIN is never shown here or anywhere.** It is a peppered scrypt hash; the
 * only thing this sheet can say about one is whether it exists.
 */
import type { UserAdmin } from '#shared/types'
import { ROLE_LABELS } from '#shared/landing'

const props = defineProps<{
  open: boolean
  user: UserAdmin | null
  /** The signed-in owner: he may not take himself off the staff. */
  isMe: boolean
  /** A write for this person is in flight. */
  pending: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  /** Hand over to `PostavkePinSheet`; the page closes this one first. */
  pin: []
  /** Hand over to `PostavkeUserSheet` — name, initials, role, e-mail. */
  edit: []
  /** Off the staff, or back on it. */
  setActive: [active: boolean]
}>()

/** The second screen: the question *Ugasi radnika* asks before it writes. */
const asking = ref(false)

watch(() => [props.open, props.user?.id], () => { asking.value = false })

/**
 * The sentence under the PIN row.
 *
 * A worker's PIN is printed above it, so the line stops promising that nothing
 * is ever shown again — it says where the number is used instead. An admin's
 * PIN genuinely cannot be read back (`server/utils/pinReveal.ts`), so his row
 * keeps the old promise, which for him is still true.
 */
const pinHint = computed(() => {
  const user = props.user
  if (!user) return ''
  if (!user.has_pin) return 'Bez PIN-a se ne može prijaviti ni na jedan telefon.'
  if (user.pin_plain) return 'Prijava na telefon. Ovim brojem se radnik prijavljuje.'
  return 'Prijava na telefon. Nigdje se ne prikazuje ponovo.'
})

/** One line under the title: what he is, and whether he can sign in. */
const summary = computed(() => {
  const user = props.user
  if (!user) return ''
  const role = ROLE_LABELS[user.role]
  if (!user.active) return `${role} · ugašen`
  return user.has_pin
    ? `${role} · prijavljuje se svojim PIN-om`
    : `${role} · još se ne može prijaviti`
})

const initials = computed(() =>
  props.user?.initials || props.user?.name.slice(0, 2).toUpperCase() || '')
</script>

<template>
  <UiSheet
    :open="open"
    :title="user?.name ?? 'Radnik'"
    :pending="pending"
    :content-key="asking ? 'gasi' : 'akcije'"
    @close="emit('close')"
  >
    <template v-if="user">
      <p v-if="error" class="p-error" role="alert">{{ error }}</p>

      <!-- ---- the question ------------------------------------------------ -->
      <template v-if="asking">
        <p class="p-ask">Ugasiti radnika {{ user.name }}?</p>
        <p class="p-hint">
          Ne prijavljuje se više i skida se s budućih smjena. Stare ture i
          smjene ostaju kako jesu, a vratiti ga možeš kad god hoćeš.
        </p>
      </template>

      <!-- ---- the actions ------------------------------------------------- -->
      <template v-else>
        <p class="p-sum">{{ summary }}</p>

        <div class="p-sets">
          <div v-if="user.active" class="p-set">
            <span class="p-set-text">
              <span class="p-set-label">
                PIN
                <UiPill v-if="!user.has_pin" tone="warn">bez PIN-a</UiPill>
              </span>
              <span v-if="user.pin_plain" class="p-pin num">{{ user.pin_plain }}</span>
              <span class="p-set-hint">
                {{ pinHint }}
              </span>
            </span>
            <UiButton small :variant="user.has_pin ? 'ghost' : 'soft'" @click="emit('pin')">
              {{ user.has_pin ? 'Novi PIN' : 'Postavi PIN' }}
            </UiButton>
          </div>

          <div class="p-set">
            <span class="p-set-text">
              <span class="p-set-label">Ime i uloga</span>
              <span class="p-set-hint">
                {{ ROLE_LABELS[user.role] }} · inicijali {{ initials }}
              </span>
            </span>
            <UiButton small variant="ghost" @click="emit('edit')">
              Izmijeni
              <UiIcon name="chevron-right" :size="18" />
            </UiButton>
          </div>

          <div class="p-set">
            <span class="p-set-text">
              <span class="p-set-label">{{ user.active ? 'Aktivan' : 'Ugašen' }}</span>
              <span class="p-set-hint">
                <template v-if="isMe">Ne možeš deaktivirati sam sebe.</template>
                <template v-else-if="user.active">
                  Ugašen radnik ostaje na svojim starim turama.
                </template>
                <template v-else>Kad se vrati, treba mu novi PIN.</template>
              </span>
            </span>
            <UiButton
              v-if="user.active"
              small
              variant="danger"
              :disabled="isMe || pending"
              @click="asking = true"
            >Ugasi radnika</UiButton>
            <UiButton
              v-else
              small
              variant="soft"
              :pending="pending"
              @click="emit('setActive', true)"
            >Vrati radnika</UiButton>
          </div>
        </div>
      </template>
    </template>

    <template #footer>
      <template v-if="asking">
        <UiButton variant="ghost" :disabled="pending" @click="asking = false">
          Odustani
        </UiButton>
        <UiButton variant="danger" :pending="pending" @click="emit('setActive', false)">
          Ugasi radnika
        </UiButton>
      </template>
      <UiButton v-else variant="ghost" @click="emit('close')">Gotovo</UiButton>
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

.p-sum { margin: 0; color: var(--muted); font-size: var(--text-micro); }

.p-ask {
  margin: 0;
  font-size: var(--text-section);
  font-weight: 600;
  color: var(--ink);
}

.p-hint { margin: 0; font-size: var(--text-micro); color: var(--muted); }

/* One list, one rule between lines — the sheet body's own gap would put air
   between rows that are meant to read as one block. */
.p-sets { display: flex; flex-direction: column; }

.p-set {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--tap);
  padding: 10px 0;
  border-bottom: 1px solid var(--line-soft);
}

.p-set:last-child { border-bottom: 0; }

.p-set-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex-grow: 1; }

.p-set-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
}

.p-set-hint { font-size: var(--text-micro); color: var(--muted); }

/** Read out across a bar: tabular, tracked, and the loudest thing in the row. */
.p-pin {
  font-size: var(--text-section);
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
</style>
