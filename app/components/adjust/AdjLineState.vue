<script setup lang="ts">
/**
 * A line that is no longer money the guest owes — struck, and told why.
 *
 * Three states, and each one is colour **and** icon **and** text (PHASE3 §4),
 * because a line that only went grey is a line a waiter will read as an ordinary
 * one in a dark corner of the terrace:
 *
 *   `applied`  grey, struck through — done, nothing waits on it;
 *   `pending`  amber, struck through — "5,00 KM ostaje u tvom pazaru dok se ne
 *              odobri", because until somebody decides, it is still his money;
 *   `queued`   amber with a clock — the request has not left this phone yet;
 *   `rejected` plain, not struck — the line is money again, and says so.
 *
 * The amount is the one thing that is never struck through: it is the number the
 * waiter has to keep in his head until the storno is decided.
 */
import { formatKm } from '#shared/money'

const props = withDefaults(defineProps<{
  /** As it was snapshotted on the round — never re-read from the catalogue. */
  name: string
  qty: number
  amountFen: number
  kind: 'void' | 'comp'
  state: 'applied' | 'pending' | 'queued' | 'rejected'
  /** What the requester wrote, if he wrote anything. */
  note?: string | null
}>(), { note: null })

const struck = computed(() => props.state !== 'rejected')

const chip = computed(() => {
  if (props.kind === 'comp') {
    if (props.state === 'applied') return { text: 'Na račun kuće', tone: 'chip-good' }
    if (props.state === 'rejected') return { text: 'Gratis odbijen', tone: 'chip-danger' }
    return { text: props.state === 'queued' ? 'Gratis čeka slanje' : 'Gratis na čekanju', tone: 'chip-warn' }
  }
  if (props.state === 'applied') return { text: 'Stornirano', tone: 'chip' }
  if (props.state === 'rejected') return { text: 'Storno odbijen', tone: 'chip-danger' }
  return { text: props.state === 'queued' ? 'Storno čeka slanje' : 'Storno na čekanju', tone: 'chip-warn' }
})

/** The sentence under the line. Only the two waiting states have one. */
const sentence = computed(() => {
  if (props.state === 'pending') {
    return `${props.kind === 'void' ? 'Storno' : 'Gratis'} čeka odobrenje —`
      + ` ${formatKm(props.amountFen)} ostaje u tvom pazaru dok se ne odobri.`
  }
  if (props.state === 'queued') return 'Nema veze — čuvamo zahtjev i šaljemo ga čim bude signala.'
  if (props.state === 'rejected') {
    return `Nije odobreno — ${formatKm(props.amountFen)} se naplaćuje gostu.`
  }
  return null
})
</script>

<template>
  <div class="flex flex-col gap-1 py-1.5">
    <div class="flex items-baseline gap-2">
      <span
        class="num shrink-0 text-[15px]"
        :class="struck ? 'text-muted' : 'text-text-2'"
      >{{ qty }}×</span>

      <span
        class="min-w-0 flex-1 truncate text-[17px]"
        :class="struck ? 'text-muted line-through' : 'text-text'"
      >{{ name }}</span>

      <span class="num shrink-0 text-[17px]" :class="struck ? 'text-muted' : 'text-text'">
        {{ formatKm(amountFen) }}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <span :class="['chip', chip.tone]">
        <!-- struck line for a void, a small house for a gratis -->
        <svg v-if="kind === 'void'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 12h16M7 7h10M7 17h10" />
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
        </svg>
        {{ chip.text }}
      </span>
      <span v-if="note" class="text-sm text-text-2">{{ note }}</span>
    </div>

    <p v-if="sentence" class="text-[15px]" :class="state === 'rejected' ? 'text-danger' : 'text-warn'">
      {{ sentence }}
    </p>
  </div>
</template>
