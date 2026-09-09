/**
 * Alerts v1 — the Telegram mirror (`docs/BACKEND.md` §9).
 *
 * The owner is not in the café every night, so thirteen kinds of thing send him
 * a message: a shift closed, a settlement outside tolerance, a void decided
 * after payment. Everything else stays in the Dnevnik, which he reads when he
 * wants to.
 *
 * Three rules do all the work:
 *
 *   **Dedupe on the object, not the event.** The unique key is
 *   `(venue_id, rule_key, ref_type, ref_id)` and the insert is `INSERT OR
 *   IGNORE`, so a shift closed and then re-summarised sends one message about
 *   that shift. This only works because `log()` passes the caller's own `ref`
 *   (§6.9) — a fresh log-entry uuid per event would be a key that never
 *   collides and therefore never dedupes.
 *
 *   **Quiet hours.** Between 03:00 and 10:00 local an alert is queued with
 *   `send_after` set to 10:00 rather than dropped, so nothing is lost and
 *   nobody's phone buzzes at four in the morning. Three rules are exempt,
 *   because they are the reason the owner has a phone at all.
 *
 *   **Sending is the only async code in the services.** `queueAlert` writes a
 *   row inside the caller's transaction and returns; a separate drainer does the
 *   network, a minute later at worst, which is fine for a mirror.
 */
import { and, asc, eq, isNull, lte, ne, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { businessDate, cutoffIso, localTime } from '#shared/dates'
import { QUIET_HOURS_EXEMPT, QUIET_HOURS_FROM, QUIET_HOURS_TO } from '#shared/constants'
import type { AlertRuleKey } from '#shared/constants'
import type { Db, Queryable, Tx } from './types'
import { getSettings } from './contracts'

/** After eight failures the row is left alone: something is wrong with the token. */
const MAX_ATTEMPTS = 8

/**
 * The one thing a sender does. Ten lines of `fetch` in production, a
 * `console.info` in dev — nothing above this line knows which.
 */
export interface AlertSender {
  send: (chatId: string, text: string) => Promise<void>
}

export interface QueueAlertInput {
  ruleKey: AlertRuleKey
  /** The object the alert is about. This is the dedupe key — see the header. */
  ref: { type: string, id: string }
  payload: Record<string, unknown>
  /** Injectable now, so a test can queue an alert at 04:00 local. */
  at?: string
}

/**
 * Queue one mirror. Returns the new row's id, or `null` when an identical alert
 * for the same object was already queued — which is a success, not an error.
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
 * When may this go out? Now, unless it is the small hours and the rule can wait.
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
  // rule is about takings, not about when a phone is allowed to buzz.
  return cutoffIso(businessDate(at, tz, 0), tz, QUIET_HOURS_TO)
}

// ---------------------------------------------------------------------------
// The drainer
// ---------------------------------------------------------------------------

/**
 * Send everything that is due. The only `async` function in `server/services`.
 *
 * Run from `server/tasks/alerts.ts` every minute (WP8) and from a 500 ms
 * debounced `bus` listener (`server/plugins/alerts.ts`) so an alert queued at
 * 23:40 does not wait for the top of the minute.
 */
export async function drainAlerts(
  db: Db, sender: AlertSender = resolveSender(), at = nowIso(),
): Promise<void> {
  const due = db.select().from(schema.alertEvents)
    .where(and(
      isNull(schema.alertEvents.sentAt),
      lte(schema.alertEvents.sendAfter, at),
      sql`${schema.alertEvents.attempts} < ${MAX_ATTEMPTS}`,
    ))
    .orderBy(asc(schema.alertEvents.sendAfter))
    .all()

  for (const row of due) {
    const recipients = chatIds(db, row.venueId)
    const text = renderMessage(row.payloadJson)

    // Nobody has pasted a chat id yet: mark it done rather than retrying eight
    // times against an empty list. A mirror is live, not history — the Dnevnik
    // is the history, and it already has the entry.
    if (recipients.length === 0) {
      db.update(schema.alertEvents).set({ sentAt: at })
        .where(eq(schema.alertEvents.id, row.id)).run()
      continue
    }

    try {
      for (const chatId of recipients) await sender.send(chatId, text)
      db.update(schema.alertEvents).set({ sentAt: at, lastError: null })
        .where(eq(schema.alertEvents.id, row.id)).run()
    } catch (err) {
      const attempts = row.attempts + 1
      db.update(schema.alertEvents)
        .set({
          attempts,
          lastError: String(err instanceof Error ? err.message : err).slice(0, 500),
          // Back off linearly: 60 s, then 120 s, then 180 s… Telegram outages
          // are minutes, not hours, and eight tries covers a 36-minute one.
          sendAfter: new Date(Date.parse(at) + attempts * 60_000).toISOString(),
        })
        .where(eq(schema.alertEvents.id, row.id))
        .run()
    }
  }
}

/** Active admins who pasted a chat id from @userinfobot into *Postavke*. */
export function chatIds(db: Queryable, venueId: string): string[] {
  return db.select({ chatId: schema.users.telegramChatId })
    .from(schema.users)
    .where(and(
      eq(schema.users.venueId, venueId),
      eq(schema.users.role, 'admin'),
      eq(schema.users.active, 1),
      sql`${schema.users.telegramChatId} is not null`,
      ne(schema.users.telegramChatId, ''),
    ))
    .all()
    .map(r => r.chatId)
    .filter((v): v is string => Boolean(v))
}

/** The title, then a deep link into the Dnevnik entry it came from. */
export function renderMessage(payloadJson: string): string {
  let payload: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>
  } catch {
    // A malformed payload still deserves a message; the link is what matters.
  }
  const title = typeof payload.title_bs === 'string' ? payload.title_bs : 'Šank'
  const logId = typeof payload.log_id === 'string' ? payload.log_id : null
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '')
  return logId ? `${title}\n${base}/a/dnevnik/${logId}` : title
}

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

/** The default, and the only sender in dev and in tests. */
export const consoleSender: AlertSender = {
  send: (chatId, text) => {
    console.info(`[alert] ${chatId} ${text}`)
    return Promise.resolve()
  },
}

/**
 * Telegram, in ten lines of `fetch`.
 *
 * **Sending only — the bot is never started and never polls.** A bot that long
 * polls holds the token's update stream exclusively, so Vedran's laptop running
 * the same token would quietly steal the VPS's updates; and nothing in Korak 2
 * needs to *receive* a message. The admin pastes his chat id (from @userinfobot)
 * into *Postavke*; there are no link codes and no library.
 */
export function telegramSender(token: string): AlertSender {
  return {
    send: async (chatId, text) => {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
      if (!response.ok) {
        throw new Error(`telegram ${response.status}: ${(await response.text()).slice(0, 200)}`)
      }
    },
  }
}

/**
 * Telegram when a token is set, the console otherwise. Read straight from the
 * environment because `nuxt.config.ts`'s `runtimeConfig` belongs to WP8; the
 * variable is the same one either way (`TELEGRAM_BOT_TOKEN` in `/opt/sank/.env`).
 */
export function resolveSender(): AlertSender {
  const token = process.env.TELEGRAM_BOT_TOKEN
  return token ? telegramSender(token) : consoleSender
}
