/**
 * Alerts v1 — the in-app *obavijesti* record (`docs/BACKEND.md` §9).
 *
 * **Nothing here sends anything.** There is no Telegram, no e-mail, no push and
 * no web hook: the Dnevnik and the attention list inside the app are the only
 * channels the owner has. `alert_events` is what makes the attention list
 * possible — the subset of Dnevnik entries worth surfacing on *Puls* rather than
 * leaving in the stream, already deduped, already time-gated.
 *
 * Two rules do all the work:
 *
 *   **Dedupe on the object, not the event.** The unique key is
 *   `(venue_id, rule_key, ref_type, ref_id)` and the insert is `INSERT OR
 *   IGNORE`, so a shift closed and then re-summarised raises one item about
 *   that shift. This only works because `log()` passes the caller's own `ref`
 *   (§6.9) — a fresh log-entry uuid per event would be a key that never
 *   collides and therefore never dedupes.
 *
 *   **Quiet hours.** Between 03:00 and 10:00 local an item is queued with
 *   `send_after` set to 10:00 rather than dropped: it is written and kept, it
 *   simply does not surface at the top of *Puls* before the owner is awake.
 *   Three rules are exempt, because they are the reason he opens the app at all.
 *
 * `queueAlert` is synchronous and writes inside the caller's transaction, like
 * `log` and `bump`. `sent_at` is a leftover column from the sender that used to
 * exist; nothing writes it any more and no reader looks at it (§9).
 */
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { businessDate, cutoffIso, localTime } from '#shared/dates'
import { QUIET_HOURS_EXEMPT, QUIET_HOURS_FROM, QUIET_HOURS_TO } from '#shared/constants'
import type { AlertRuleKey } from '#shared/constants'
import type { Tx } from './types'
import { getSettings } from './contracts'

export interface QueueAlertInput {
  ruleKey: AlertRuleKey
  /** The object the alert is about. This is the dedupe key — see the header. */
  ref: { type: string, id: string }
  payload: Record<string, unknown>
  /** Injectable now, so a test can queue an alert at 04:00 local. */
  at?: string
}

/**
 * Queue one item for the attention list. Returns the new row's id, or `null`
 * when an identical alert for the same object was already queued — which is a
 * success, not an error.
 */
export function queueAlert(tx: Tx, venueId: string, a: QueueAlertInput): string | null {
  const at = a.at ?? nowIso()
  const settings = getSettings(tx, venueId)
  const id = newId()

  const row = tx.insert(schema.alertEvents)
    .values({
      id,
      venueId,
      ruleKey: a.ruleKey,
      refType: a.ref.type,
      refId: a.ref.id,
      payloadJson: JSON.stringify(a.payload),
      createdAt: at,
      sendAfter: sendAfter(a.ruleKey, at, settings.timezone),
      sentAt: null,
      attempts: 0,
      lastError: null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.alertEvents.id })
    .get()

  return row?.id ?? null
}

/**
 * When may this surface? Now, unless it is the small hours and the rule can
 * wait.
 *
 * The local hour is read through `localTime` and never `getHours()` — the server
 * runs on `TZ=UTC` (§10), so "is it 04:00 in Sarajevo" is a question only
 * `Intl` can answer correctly, DST nights included.
 */
export function sendAfter(rule: AlertRuleKey, at: string, tz: string): string {
  if (QUIET_HOURS_EXEMPT.includes(rule)) return at
  const hour = Number(localTime(at, tz).slice(0, 2))
  if (hour < QUIET_HOURS_FROM || hour >= QUIET_HOURS_TO) return at
  // 10:00 local on the calendar date it is locally right now. `businessDate`
  // with a start hour of 0 is the plain local date — the 06:00 business-day
  // rule is about takings, not about when an item may reach the owner's eyes.
  return cutoffIso(businessDate(at, tz, 0), tz, QUIET_HOURS_TO)
}
