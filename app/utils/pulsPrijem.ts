/**
 * *Prijem robe danas* on *Puls* — which deliveries count as today's, and what
 * they add up to.
 *
 * Today is the café's business day (`businessDate`, 06:00 Europe/Sarajevo), read
 * off when the delivery was **entered**, not the date typed from the invoice: the
 * owner is asking "did goods come in today", and an invoice dated yesterday that
 * was booked this morning is today's answer. A reversed delivery stays in the
 * list, marked, but adds nothing to the total.
 */
import { businessDate } from '#shared/dates'
import type { DeliveryView } from '#shared/types'

export interface PrijemToday {
  deliveries: DeliveryView[]
  /** Σ total_fen of the deliveries that were not reversed. */
  total_fen: number
  /** The newest entry time, for the card's date and time line. */
  last_at: string | null
}

export function prijemToday(deliveries: DeliveryView[], nowIso: string): PrijemToday {
  const today = businessDate(nowIso)
  const todays = deliveries
    .filter(d => d.created_at && businessDate(d.created_at) === today)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return {
    deliveries: todays,
    total_fen: todays.filter(d => !d.reversed_at).reduce((sum, d) => sum + d.total_fen, 0),
    last_at: todays[0]?.created_at ?? null,
  }
}
