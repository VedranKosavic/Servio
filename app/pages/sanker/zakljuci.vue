<script setup lang="ts">
/**
 * `/sanker/zakljuci` — *Zaključi smjenu*, the šanker's end of the night.
 *
 * The owner's close is a subtraction, not a cash count. The server says six
 * numbers (*Sav prihod*, *Dnevnica*, *Otpis*, *Rashod*, *Policija*, *Osoblje* —
 * the last four counted from the tabs marked with them tonight), the šanker types
 * what he paid out of the takings, and the screen shows *Za predati* live as he types —
 * computed by `zaPredati` from `shared/closing.ts`, the same function the server
 * stores its own number with. A negative result is shown as it is.
 *
 * **Online only, on purpose.** Everything else a šanker queues (otpis, popis)
 * goes through the outbox; this does not, because a close is only true against
 * the server's numbers at the moment it happens. The POST carries a `client_id`
 * minted once per visit, so a retry of the same tap is a replay and answers the
 * stored row. With no network the button says so instead of queueing.
 *
 * Two steps before the POST: a fresh preview (the night kept going while he
 * typed), then *Zaključiti smjenu?* with *Odustani* / *Zaključi*.
 */
import { useOnline } from '@vueuse/core'
import { formatKm, parseKm } from '#shared/money'
import { CLOSING_LINES, TYPED_KEYS, type TypedKey, zaPredati } from '#shared/closing'
import { localTime, shortDateBs } from '#shared/dates'
import type { ClosingPreview, ShiftClosing } from '#shared/types'
import { ApiSideError } from '~/composables/useApi'

useHead({ title: 'Zaključi smjenu' })

const api = useApi()
const me = useMe()
useOutbox()
const { blocked, blockedText } = useSync()
const online = useOnline()

const menuOpen = ref(false)

const preview = ref<ClosingPreview | null>(null)
const done = ref<ShiftClosing | null>(null)
const noShift = ref(false)
const loading = ref(true)
const loadError = ref<string | null>(null)

/** One id for this visit: a second tap after a lost answer replays, never doubles. */
const clientId = ref(crypto.randomUUID())

const LABELS: Record<TypedKey, string> = {
  roba_fen: 'Plaćanje robe',
  okusi_fen: 'Plaćanje okusa za nargilu',
  zar_fen: 'Plaćanje žara',
  merkator_fen: 'Merkator',
}

const raw = reactive<Record<TypedKey, string>>({
  roba_fen: '', okusi_fen: '', zar_fen: '', merkator_fen: '',
})
const note = ref('')

const confirming = ref(false)
const posting = ref(false)
const postError = ref<string | null>(null)

const isSanker = computed(() => me.mode.value === 'sanker')

onMounted(async () => {
  if (!(await me.requireSession())) return
  await load()
})

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const mine = await api.getMyShift()
    const shiftId = mine.shift?.id
    if (!shiftId) {
      noShift.value = true
      preview.value = null
      return
    }
    noShift.value = false
    preview.value = await api.getClosingPreview(shiftId)
    done.value = preview.value.closing
  } catch (err) {
    if (!(await me.handleAuthError(err))) loadError.value = apiErrorText(err)
  } finally {
    loading.value = false
  }
}

/** Empty is 0; anything that does not parse, or is below zero, is `null`. */
function amountOf(key: TypedKey): number | null {
  const text = raw[key].trim()
  if (text === '') return 0
  const fen = parseKm(text)
  return fen === null || fen < 0 ? null : fen
}

const amounts = computed(() => {
  const out = {} as Record<TypedKey, number>
  for (const key of TYPED_KEYS) out[key] = amountOf(key) ?? 0
  return out
})

const invalid = computed(() => TYPED_KEYS.filter(key => amountOf(key) === null))

const result = computed(() => {
  const p = preview.value
  if (!p) return 0
  return zaPredati({
    prihod_fen: p.prihod_fen, dnevnica_fen: p.dnevnica_fen, otpis_fen: p.otpis_fen,
    rashod_fen: p.rashod_fen, policija_fen: p.policija_fen, osoblje_fen: p.osoblje_fen,
    ...amounts.value,
  })
})

const openTabs = computed(() => preview.value?.open_tabs ?? [])

const canClose = computed(() =>
  isSanker.value && !!preview.value && openTabs.value.length === 0
  && invalid.value.length === 0 && !posting.value)

/** The night kept going while he typed: re-read before asking the question. */
async function askConfirm() {
  postError.value = null
  if (!online.value) {
    postError.value = 'Nema mreže. Zaključenje traži vezu sa serverom — pokušaj kad se telefon spoji.'
    return
  }
  if (blocked.value) {
    postError.value = `${blockedText.value} — sačekaj da odu, pa zaključi.`
    return
  }
  const shiftId = preview.value?.shift_id
  if (!shiftId) return
  try {
    preview.value = await api.getClosingPreview(shiftId)
    if (preview.value.closing) {
      done.value = preview.value.closing
      return
    }
    if (preview.value.open_tabs.length === 0) confirming.value = true
  } catch (err) {
    postError.value = apiErrorText(err)
  }
}

async function close() {
  const shiftId = preview.value?.shift_id
  if (!shiftId || posting.value) return
  posting.value = true
  postError.value = null
  try {
    done.value = await api.closeShiftByBar(shiftId, {
      client_id: clientId.value,
      ...amounts.value,
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
    })
    confirming.value = false
  } catch (err) {
    confirming.value = false
    postError.value = !online.value
      ? 'Nema mreže. Zaključenje traži vezu sa serverom — pokušaj kad se telefon spoji.'
      : apiErrorText(err)
    // A table opened while he was confirming: show which one.
    if (err instanceof ApiSideError && err.code === 'OPEN_TABS') await load()
    void me.handleAuthError(err)
  } finally {
    posting.value = false
  }
}

/** The done card's lines, from the stored row — never recomputed here. */
function lineValue(closing: ShiftClosing, key: (typeof CLOSING_LINES)[number]['key']): number {
  return closing[key]
}
</script>

<template>
  <ClientOnly>
    <div class="flex flex-1 flex-col">
      <WaiterHeader title="Zaključi smjenu" back-to="/sanker">
        <template #right>
          <WaiterSyncChip compact />
        </template>
      </WaiterHeader>

      <WaiterOutboxBanner />

      <main class="flex flex-1 flex-col gap-4 py-4">
        <p v-if="loading" class="py-10 text-center text-text-2">
          Učitavanje…
        </p>

        <div v-else-if="loadError" class="card flex flex-col gap-3 p-4 text-center">
          <p class="text-danger">
            {{ loadError }}
          </p>
          <button type="button" class="btn btn-ghost" @click="load">
            Pokušaj ponovo
          </button>
        </div>

        <p v-else-if="!isSanker" class="empty">
          Smjenu zaključuje šanker.
          <span>Prebaci na šank iz menija pa otvori ovaj ekran ponovo.</span>
        </p>

        <!-- Done: the stored row, as the owner will read it -->
        <section v-else-if="done" class="card flex flex-col gap-3 p-4">
          <div>
            <h2 class="section-title">
              Smjena je zaključena
            </h2>
            <p class="text-label text-text-2">
              {{ shortDateBs(done.business_date) }} · {{ done.closed_by_name }} · {{ localTime(done.created_at) }}
            </p>
          </div>

          <div class="flex flex-col gap-1.5 text-body">
            <div class="flex justify-between gap-3">
              <span class="text-text-2">Sav prihod</span>
              <span class="num font-semibold">{{ formatKm(done.prihod_fen) }}</span>
            </div>
            <div v-for="line in CLOSING_LINES" :key="line.key" class="flex justify-between gap-3">
              <span class="text-text-2">− {{ line.label }}</span>
              <span class="num">{{ formatKm(lineValue(done, line.key)) }}</span>
            </div>
            <div class="flex justify-between gap-3 border-t border-line-soft pt-2">
              <span class="font-semibold">Za predati</span>
              <span class="num text-title font-bold" :class="done.za_predati_fen < 0 ? 'text-danger' : 'text-text'">
                {{ formatKm(done.za_predati_fen) }}
              </span>
            </div>
          </div>

          <p v-if="done.note" class="text-label text-text-2">
            {{ done.note }}
          </p>

          <NuxtLink to="/sanker" class="btn btn-primary btn-lg">
            Gotovo
          </NuxtLink>
        </section>

        <p v-else-if="noShift || !preview" class="empty">
          Nema otvorene smjene.
          <span>Smjena se otvara prvom zaključanom turom.</span>
        </p>

        <template v-else>
          <!-- What the server says -->
          <section class="card flex flex-col gap-1.5 p-4 text-body">
            <h2 class="section-title">
              Smjena {{ shortDateBs(preview.business_date) }}
            </h2>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">Sav prihod</span>
              <span class="num font-semibold">{{ formatKm(preview.prihod_fen) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">− Dnevnica</span>
              <span class="num">{{ formatKm(preview.dnevnica_fen) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">− Otpis</span>
              <span class="num">{{ formatKm(preview.otpis_fen) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">− Rashod</span>
              <span class="num">{{ formatKm(preview.rashod_fen) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">− Policija</span>
              <span class="num">{{ formatKm(preview.policija_fen) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-2">− Osoblje</span>
              <span class="num">{{ formatKm(preview.osoblje_fen) }}</span>
            </div>
            <p class="text-label text-text-2">
              Ovo računa server: prihod je sve prodato u smjeni, a otpis, rashod,
              policija i osoblje su računi koje ste večeras tako označili — po
              cijeni s menija.
            </p>
          </section>

          <!-- What blocks the close -->
          <section v-if="openTabs.length" class="card flex flex-col gap-2 border-warn p-4">
            <h2 class="section-title">
              Otvoreni stolovi
            </h2>
            <p class="text-label text-text-2">
              Smjena se ne može zaključiti dok su ovi stolovi otvoreni. Naplati ih ili ih označi kao neplaćene.
            </p>
            <ul class="flex flex-wrap gap-2">
              <li v-for="tab in openTabs" :key="tab.tab_id" class="chip chip-warn">
                {{ tab.table_name }}
              </li>
            </ul>
            <button type="button" class="btn btn-ghost" @click="load">
              Osvježi
            </button>
          </section>

          <!-- What he paid out tonight -->
          <section class="card flex flex-col gap-3 p-4">
            <div>
              <h2 class="section-title">
                Plaćeno iz pazara
              </h2>
              <p class="text-label text-text-2">
                Upiši samo ono što je plaćeno. Prazno polje je 0,00 KM.
              </p>
            </div>

            <label v-for="key in TYPED_KEYS" :key="key" class="flex flex-col gap-1.5">
              <span class="text-label text-text-2">{{ LABELS[key] }}</span>
              <span
                class="input input-num flex items-center gap-2 px-4"
                :class="invalid.includes(key) ? 'border-danger' : ''"
              >
                <input
                  v-model="raw[key]"
                  type="text"
                  inputmode="decimal"
                  placeholder="0,00"
                  class="num min-w-0 flex-1 self-stretch bg-transparent text-right text-title font-semibold outline-none placeholder:text-muted"
                  :aria-label="LABELS[key]"
                >
                <span class="shrink-0 text-label font-normal text-text-2">KM</span>
              </span>
              <span v-if="invalid.includes(key)" class="text-label text-danger">
                Upiši iznos, npr. 12,50
              </span>
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-label text-text-2">Napomena</span>
              <input
                v-model="note"
                type="text"
                maxlength="500"
                placeholder="Nije obavezno"
                class="input px-4"
              >
            </label>
          </section>

          <!-- The answer, live -->
          <section class="card flex items-baseline justify-between gap-3 p-4">
            <span class="section-title">Za predati</span>
            <span class="num text-title font-bold" :class="result < 0 ? 'text-danger' : 'text-text'">
              {{ formatKm(result) }}
            </span>
          </section>

          <p v-if="!online" class="note note-warn" role="status">
            Nema mreže. Zaključenje traži vezu sa serverom.
          </p>
          <p v-else-if="blocked" class="note note-warn" role="status">
            {{ blockedText }} — sačekaj da odu, pa zaključi.
          </p>
          <p v-if="postError" class="note note-danger" role="alert">
            {{ postError }}
          </p>

          <button
            type="button"
            class="btn btn-primary btn-lg"
            :disabled="!canClose"
            @click="askConfirm"
          >
            Zaključi smjenu
          </button>
        </template>
      </main>

      <!-- Zaključiti smjenu? -->
      <template v-if="confirming && preview">
        <div class="sheet-scrim fixed inset-0 z-40" @click="confirming = false" />
        <div
          class="sheet-panel fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 px-4 pt-4 pb-5"
          role="dialog"
          aria-label="Zaključiti smjenu?"
        >
          <h2 class="section-title">
            Zaključiti smjenu?
          </h2>
          <p class="text-label text-text-2">
            Smjena se zatvara za sve. Sljedeća tura otvara novu smjenu.
          </p>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-text-2">Za predati</span>
            <span class="num text-title font-bold" :class="result < 0 ? 'text-danger' : 'text-text'">
              {{ formatKm(result) }}
            </span>
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn btn-secondary btn-lg flex-1" :disabled="posting" @click="confirming = false">
              Odustani
            </button>
            <button type="button" class="btn btn-primary btn-lg flex-1" :disabled="posting" @click="close">
              {{ posting ? 'Zaključujem…' : 'Zaključi' }}
            </button>
          </div>
        </div>
      </template>

      <WaiterAvatarSheet v-if="menuOpen" @close="menuOpen = false" />
    </div>

    <template #fallback>
      <p class="py-10 text-center text-text-2">
        Učitavanje…
      </p>
    </template>
  </ClientOnly>
</template>
