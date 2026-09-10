<script setup lang="ts">
/**
 * *Traži zamjenu* — the one door a waiter's sickness enters through. Dark kit.
 *
 * Five or six taps: the shift, *Traži zamjenu*, an optional colleague, the
 * reason, an optional note, *Pošalji*. The colleague is optional on purpose — an
 * open offer any of the four can take fills faster than one aimed at a name.
 *
 * **What the room sees is the same for both reasons.** *bolest* marks the row
 * `sick` and raises an attention row for the owner, but the *Konobari* line is
 * identical to a plain *zamjena* — a distinct wording would itself be the
 * reason, and *Pravila* says "Bolovanje vidi samo vlasnik". The sentence under
 * the chips tells the person that, so he knows what he is publishing.
 */
import type { Assignment } from '#shared/types'

const props = defineProps<{
  person: Assignment
  colleagues: { id: string, name: string }[]
  offline: boolean
  busy: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  send: [body: { to_user_id?: string, reason: 'zamjena' | 'bolest', note?: string }]
}>()

useSheetDismiss(() => emit('close'))

/** The sheet opens on the shift, not on a form: one look before any typing. */
const step = ref<'shift' | 'form'>('shift')

const to = ref<string>('')
const reason = ref<'zamjena' | 'bolest'>('zamjena')
const note = ref('')

const span = computed(() =>
  `${props.person.template_name} ${timeSpanBs(props.person.start_time, props.person.end_time)}`)

function send() {
  emit('send', {
    ...(to.value ? { to_user_id: to.value } : {}),
    reason: reason.value,
    ...(note.value.trim() ? { note: note.value.trim() } : {}),
  })
}
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Zamjena"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div>
        <h2 class="section-title">{{ dayLabelBs(person.work_date) }}</h2>
        <p class="num text-label text-text-2">{{ span }}</p>
      </div>

      <p v-if="offline" class="note note-warn">
        Nema veze — zamjena traži internet. Smjena ostaje tvoja.
      </p>
      <p v-else-if="error" class="note note-danger" role="alert">
        {{ error }}
      </p>

      <template v-if="step === 'shift'">
        <button
          type="button" class="btn btn-primary"
          :disabled="offline || busy"
          @click="step = 'form'"
        >
          Traži zamjenu
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Zatvori</button>
      </template>

      <template v-else>
        <div class="flex flex-col gap-2">
          <span class="text-label text-text-2">Kome (nije obavezno)</span>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="flex min-h-12 items-center rounded-chip border-[1.5px] px-4 text-label font-semibold"
              :class="to === '' ? 'border-accent bg-accent text-accent-ink' : 'border-line text-text-2'"
              @click="to = ''"
            >
              Svima
            </button>
            <button
              v-for="person2 in colleagues"
              :key="person2.id"
              type="button"
              class="flex min-h-12 items-center rounded-chip border-[1.5px] px-4 text-label font-semibold"
              :class="to === person2.id ? 'border-accent bg-accent text-accent-ink' : 'border-line text-text-2'"
              @click="to = person2.id"
            >
              {{ person2.name }}
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-label text-text-2">Razlog</span>
          <div class="flex gap-2">
            <button
              v-for="option in ([
                { id: 'zamjena', label: 'Zamjena' },
                { id: 'bolest', label: 'Bolest' },
              ] as const)"
              :key="option.id"
              type="button"
              class="flex min-h-12 flex-1 items-center justify-center rounded-chip border-[1.5px] text-label font-semibold"
              :class="reason === option.id ? 'border-accent bg-accent text-accent-ink' : 'border-line text-text-2'"
              @click="reason = option.id"
            >
              {{ option.label }}
            </button>
          </div>
          <p class="text-caption tracking-normal text-muted">
            Kolege vide istu poruku za oba razloga. Bolovanje vidi samo vlasnik.
          </p>
        </div>

        <label class="flex flex-col gap-2">
          <span class="text-label text-text-2">Napomena (nije obavezno)</span>
          <textarea
            v-model="note"
            class="card-2 min-h-20 resize-none rounded-control px-3 py-2 text-body text-text"
            maxlength="200"
            rows="2"
          />
        </label>

        <button
          type="button" class="btn btn-primary"
          :disabled="offline || busy"
          @click="send"
        >
          Pošalji
        </button>
        <button type="button" class="btn btn-ghost" @click="emit('close')">Odustani</button>
      </template>
    </div>
  </div>
</template>
