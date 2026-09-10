<script setup lang="ts">
/**
 * *Odobri PIN-om* — an approver's PIN, typed on the requester's own phone.
 *
 * This is the one place in `/konobar` where somebody who is not holding the
 * phone puts his digits into it, and it is deliberately narrow:
 *
 * - **Only the people who may actually approve are listed.** The filter is the
 *   venue's `approver_roles`, never yourself, and never the owner unless this is
 *   his own bound phone — `ADMIN_PIN_FOREIGN_DEVICE` refuses that, and a button
 *   that always fails is worse than no button (F6 step 3).
 * - **The PIN is never stored.** It is typed, posted and forgotten: the sheet
 *   holds no draft of it, the outbox never sees it, and the parent gets an
 *   outcome rather than digits. A wrong PIN leaves an `auth_attempts` row on the
 *   server like every other door, so the lockout ladder counts it.
 * - **It never blocks the storno.** *Bez PIN-a* is right there, and it is the
 *   honest path: the request goes on the queue and the amount stays in the
 *   requester's pazar until the bartender answers from his own phone.
 *
 * The keypad is the same one the lock screen uses, so the number of dots comes
 * from the approver's own `pin_len` — four for a waiter, six for Emir.
 */
import type { MeUser } from '#shared/types'

const props = withDefaults(defineProps<{
  approvers: MeUser[]
  /** What is being approved: "Storno · Kafa · 2,00 KM". */
  what: string
  busy?: boolean
  error?: string | null
}>(), { busy: false, error: null })

const emit = defineEmits<{
  close: []
  /** Whoever was picked, and the digits he typed. Used once, then dropped. */
  submit: [approver: { user_id: string, pin: string }]
  /** *Bez PIN-a* — send the request and let it wait. */
  skip: []
}>()

useSheetDismiss(() => emit('close'))

const picked = ref<MeUser | null>(null)

// A rejected PIN comes back to the pad, not to the list: it is nearly always the
// right person and the wrong digits.
watch(() => props.approvers, (list) => {
  if (picked.value && !list.some(u => u.id === picked.value!.id)) picked.value = null
})

function submit(pin: string) {
  if (!picked.value || props.busy) return
  emit('submit', { user_id: picked.value.id, pin })
}

/**
 * A person is a *radnik* or the *vlasnik*; *konobar* and *šanker* are screens,
 * not account types, and this sheet names a person. `ROLE_LABELS` in
 * `shared/landing.ts` is the same pair with capitals, for the screens that use
 * it as a heading rather than as a line under a name.
 */
const ROLE_WORD: Record<string, string> = {
  admin: 'vlasnik',
  radnik: 'radnik',
}
</script>

<template>
  <div class="fixed inset-0 z-[60]">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Odobrenje PIN-om"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <h2 class="section-title">
        Odobri PIN-om
      </h2>
      <p class="-mt-1 text-label text-text-2">
        {{ what }}
      </p>

      <!-- Who -->
      <template v-if="!picked">
        <p class="text-label text-text-2">
          Neka šanker unese svoj PIN na ovom telefonu. Bez PIN-a zahtjev ide na čekanje.
        </p>

        <button
          v-for="user in approvers"
          :key="user.id"
          type="button"
          class="btn btn-secondary btn-lg justify-start gap-3"
          @click="picked = user"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-label font-bold">
            {{ user.initials }}
          </span>
          <span class="min-w-0 flex-1 truncate text-left">{{ user.name }}</span>
          <span class="shrink-0 text-label font-normal text-text-2">
            {{ ROLE_WORD[user.role] ?? user.role }}
          </span>
        </button>

        <p v-if="approvers.length === 0" class="note">
          Niko od odobravatelja nije dostupan na ovom telefonu. Zahtjev ide na čekanje.
        </p>
      </template>

      <!-- The pad -->
      <template v-else>
        <WaiterPinPad
          :name="picked.name"
          :initials="picked.initials"
          :pin-len="picked.pin_len"
          :busy="busy"
          :error="error"
          @submit="submit"
          @cancel="picked = null"
        />
      </template>

      <div class="mt-1 flex flex-col gap-2 border-t border-line pt-3">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('skip')">
          Bez PIN-a — pošalji na čekanje
        </button>
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="emit('close')">
          Otkaži
        </button>
      </div>
    </div>
  </div>
</template>
