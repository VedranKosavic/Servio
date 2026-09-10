/**
 * What the phone tells the person about its own honesty.
 *
 * One chip in every `/konobar` and `/sanker` header, three states, and each one
 * is colour
 * **and** word — a chip that only changed colour would be invisible to the
 * waiter who is colour-blind and useless in the dark corner of the terrace
 * (PHASE3 §4: "State is colour and icon and text").
 *
 * | state | chip |
 * |---|---|
 * | queue empty, last poll succeeded | green · *Sinhronizovano* |
 * | queue non-empty, network fine    | amber · *Čeka slanje (2)* |
 * | last attempt failed              | red · *Nema veze — narudžbe se čuvaju* |
 *
 * Red **never** blocks adding, locking or paying (PLAN §10, invariant 5). It is
 * a statement about the network, not a permission. The one thing a non-empty
 * queue does block is *Odjavi se*, because logging out on a shared tablet is
 * how a queue gets orphaned on somebody else's session.
 */
import { useOutboxStore } from '~/stores/outbox'

export type SyncState = 'ok' | 'waiting' | 'offline'

/** 1 → "1 neposlanu narudžbu", 2–4 → "2 neposlane narudžbe", else "…nih narudžbi". */
export function neposlaneText(n: number): string {
  const ones = n % 10
  const tens = n % 100
  if (ones === 1 && tens !== 11) return `${n} neposlanu narudžbu`
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${n} neposlane narudžbe`
  return `${n} neposlanih narudžbi`
}

export function useSync() {
  const outbox = useOutboxStore()

  /**
   * Did the last `/api/changes` reach the server? `useChanges()` writes it here
   * rather than returning it, so a chip rendered anywhere on the page can read
   * the same answer without being handed a prop through three components.
   */
  const pollOk = useState<boolean>('sank:poll-ok', () => true)

  const pending = computed(() => outbox.pending)

  const state = computed<SyncState>(() => {
    if (!pollOk.value || !outbox.online) return 'offline'
    return pending.value > 0 ? 'waiting' : 'ok'
  })

  /**
   * The word on the chip.
   *
   * PHASE3 §2.3's table gives red the sentence *"Nema veze — narudžbe se
   * čuvaju"*, and WP0's done-when in §3 asks that a phone with three things
   * queued read *"Čeka slanje (3)"* — with the network off, which is red. Both
   * are right about something the waiter needs, so red says both: the reason
   * first, then the count, and the reassuring half is kept for the case it was
   * written for — the network is gone and there is nothing waiting.
   */
  const label = computed(() => {
    if (state.value === 'offline') {
      return pending.value > 0
        ? `Nema veze — čeka slanje (${pending.value})`
        : 'Nema veze — narudžbe se čuvaju'
    }
    if (state.value === 'waiting') return `Čeka slanje (${pending.value})`
    return 'Sinhronizovano'
  })

  /** Under the header, and only once something has been waiting five minutes. */
  const banner = computed<string | null>(() => (
    outbox.hasStale
      ? 'Nešto čeka slanje duže od 5 minuta — uključi Wi-Fi ili mobilne podatke.'
      : null
  ))

  /** *Odjavi se* and *Završi smjenu* both ask this before they do anything. */
  const blocked = computed(() => pending.value > 0)
  const blockedText = computed(() => `Imaš ${neposlaneText(pending.value)}`)

  /**
   * The lock toast: what the waiter reads after *Potvrdi*. It tells the truth
   * about where the round actually is, which is the whole contract of an
   * outbox — "Poslano" when the server has it, "Sačuvano · čeka slanje" when
   * only this phone does.
   */
  function lockToast(tableName: string, roundLabel?: string): string {
    const tail = roundLabel ? ` · ${roundLabel}` : ''
    return state.value === 'offline' || pending.value > 0
      ? `Sačuvano · čeka slanje · ${tableName}${tail}`
      : `Poslano · ${tableName}${tail}`
  }

  return { state, label, banner, pending, blocked, blockedText, pollOk, lockToast, outbox }
}
