/**
 * *Razgovor* (PHASE4 §2.5, PLAN F12).
 *
 * Three rooms, one venue-wide `seq`, and one function deciding access.
 *
 * **`canSee` is asked before the query, never after it.** Every read below
 * builds its `WHERE channel_id IN (…)` out of `visibleChannelIds()`, so a row
 * from a channel this actor may not open is never selected at all. That is the
 * difference between "the owner does not see *Konobari*" as a rule and as a
 * `.filter()` somebody can forget — and CLAUDE.md makes it a promise published
 * in *Pravila*.
 *
 * **`seq` is venue-wide.** `MAX(seq)+1` assigned inside the insert transaction,
 * exactly like `orders.shift_seq`. One integer is therefore the cursor for all
 * three channels, so catching up is `seq > cursor` and not three cursors a phone
 * could hold at three different ages.
 *
 * **Chat never touches money.** A chat write bumps the `chat` entity and nothing
 * else; unsent messages live in the chat store's own pending list and are
 * counted in no outbox, no heartbeat and no settlement gate (PHASE4 §1). A stuck
 * "nema leda" must not stop a cash handover.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { conflict, forbidden, notFound, SankError, unprocessable } from '../utils/errors'
import { errorMessage } from '#shared/errors'
import { clampEventAt, localTime } from '#shared/dates'
import { canSee, CHANNEL_NAMES, looksLikeMoney } from '#shared/chat'
import type { ChannelKind } from '#shared/chat'
import type {
  ChatChangesSnapshot, ChatChannelView, ChatMessage, ChatPage, ChatSince,
  PostMessageBody, PostMessageResult, SystemPayload,
} from '#shared/types'
import type { Actor, Db, Queryable, Tx } from './types'
import { bump } from './changes'
import { getSettings } from './contracts'
import { log } from './log'
import { unlinkUpload, visibleChannelIds } from './uploads'

/** The last 30 messages per channel on a cold open; 200 per catch-up. */
const BOOTSTRAP_PER_CHANNEL = 30
const SINCE_CAP = 200
const HISTORY_CAP = 50
/** Further behind than this and the client re-bootstraps rather than back-filling. */
const RESET_AFTER = 1000

type ChannelRow = typeof schema.chatChannels.$inferSelect
type MessageRow = typeof schema.chatMessages.$inferSelect

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `GET /api/chat/since?cursor=` — bootstrap, catch-up, or *start again*.
 *
 * With no cursor: every channel this role may open, its last 30 messages, and
 * `cursor = MAX(seq)`. With one: everything above it, capped at 200, oldest
 * first, plus the channel headers so the badges move in the same answer.
 */
export function chatSince(
  q: Queryable, venueId: string, actor: Actor, cursor: number | null,
): ChatSince {
  const channels = visibleChannels(q, venueId, actor)
  const ids = channels.map(c => c.id)
  const top = maxChatSeq(q, venueId)

  if (ids.length === 0) {
    return { cursor: top, channels: [], messages: [], has_more: false }
  }

  const names = nameMap(q, venueId)
  const views = channels.map(c => channelView(q, venueId, actor, c))
  const muted = mutedUntil(q, venueId, actor.userId)

  if (cursor === null || cursor <= 0) {
    const messages = channels.flatMap(c =>
      q.select().from(schema.chatMessages)
        .where(and(
          eq(schema.chatMessages.venueId, venueId),
          eq(schema.chatMessages.channelId, c.id),
        ))
        .orderBy(desc(schema.chatMessages.seq))
        .limit(BOOTSTRAP_PER_CHANNEL)
        .all()
        .reverse())
      .sort((a, b) => a.seq - b.seq)

    return {
      cursor: top,
      channels: views,
      messages: hydrate(q, venueId, messages.map(m => toWire(m, channels, names))),
      has_more: false,
      muted_until: muted,
    }
  }

  // Too far behind to describe. A partial thread painted over a stale one is
  // worse than starting again, and starting again is one request.
  if (top - cursor > RESET_AFTER) {
    return { cursor: top, channels: views, messages: [], has_more: false, reset: true, muted_until: muted }
  }

  const rows = q.select().from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.venueId, venueId),
      inArray(schema.chatMessages.channelId, ids),
      gt(schema.chatMessages.seq, cursor),
    ))
    .orderBy(asc(schema.chatMessages.seq))
    .limit(SINCE_CAP + 1)
    .all()

  const page = rows.slice(0, SINCE_CAP)
  return {
    cursor: page.length > 0 ? page[page.length - 1]!.seq : top,
    channels: views,
    messages: hydrate(q, venueId, page.map(m => toWire(m, channels, names))),
    has_more: rows.length > SINCE_CAP,
    muted_until: muted,
  }
}

/** `GET /api/chat/:channel/messages?before_seq=&limit=` — *Učitaj starije*. */
export function chatHistory(
  q: Queryable, venueId: string, actor: Actor,
  kind: ChannelKind, beforeSeq: number | null, limit: number,
): ChatPage {
  const channel = requireVisibleChannel(q, venueId, actor, kind)
  const capped = Math.min(Math.max(limit, 1), HISTORY_CAP)

  const where = [
    eq(schema.chatMessages.venueId, venueId),
    eq(schema.chatMessages.channelId, channel.id),
  ]
  if (beforeSeq !== null && beforeSeq > 0) where.push(lt(schema.chatMessages.seq, beforeSeq))

  const rows = q.select().from(schema.chatMessages)
    .where(and(...where))
    .orderBy(desc(schema.chatMessages.seq))
    .limit(capped + 1)
    .all()

  const page = rows.slice(0, capped).reverse()
  return {
    messages: hydrate(q, venueId, page.map(m => toWire(m, [channel], nameMap(q, venueId)))),
    has_more: rows.length > capped,
  }
}

/** The badge snapshot `GET /api/changes` carries — the whole of "one poll". */
export function chatSnapshot(q: Queryable, venueId: string, actor: Actor): ChatChangesSnapshot {
  const channels = visibleChannels(q, venueId, actor)
  const rows = channels.map((c) => {
    const last = lastSeqOf(q, venueId, c.id)
    return { kind: c.kind as ChannelKind, unread: unreadOf(q, venueId, actor, c.id), last_seq: last }
  })
  return {
    max_seq: maxChatSeq(q, venueId),
    total_unread: rows.reduce((n, r) => n + r.unread, 0),
    channels: rows,
  }
}

/**
 * The reader's own read cursor, for the ETag.
 *
 * Without it a phone that has just marked a channel read would 304 its way to a
 * stale badge: `MAX(seq)` did not move, the role and user did not move, and the
 * one thing that *did* move is not in the tag (PHASE4 §2.11).
 */
export function myReadTag(q: Queryable, venueId: string, actor: Actor): number {
  const row = q.select({ max: sql<number | null>`max(${schema.chatReads.lastReadSeq})` })
    .from(schema.chatReads)
    .where(and(eq(schema.chatReads.venueId, venueId), eq(schema.chatReads.userId, actor.userId)))
    .get()
  return row?.max ?? 0
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * `POST /api/chat/:channel/messages`.
 *
 * The replay lookup on `(venue_id, client_id)` is the first statement inside the
 * transaction and a replay answers **200** with the stored row — never a 409
 * (CLAUDE.md). A phone that queued a message on dead wifi and flushed it twice
 * must end up with one bubble.
 */
export function postMessage(
  db: Db, venueId: string, actor: Actor, kind: ChannelKind,
  body: PostMessageBody, now = nowIso(),
): PostMessageResult {
  const result = db.transaction((tx) => {
    const replay = tx.select().from(schema.chatMessages)
      .where(and(
        eq(schema.chatMessages.venueId, venueId),
        eq(schema.chatMessages.clientId, body.client_id),
      ))
      .get()
    if (replay) return { row: replay, replayed: true }

    const channel = requireVisibleChannel(tx, venueId, actor, kind)
    requireNotMuted(tx, venueId, actor, now)

    const settings = getSettings(tx, venueId)
    const text = body.body?.trim() ?? ''

    if (body.kind === 'text' && text.length === 0) {
      throw unprocessable('BODY_EMPTY', 'a text message needs a body')
    }
    if (text.length > 2000) throw unprocessable('BODY_TOO_LONG', 'a message is at most 2000 characters')

    let uploadId: string | null = null
    if (body.kind === 'image') {
      if (!body.upload_id) throw unprocessable('BODY_EMPTY', 'an image message needs an upload')
      const upload = tx.select().from(schema.uploads)
        .where(and(eq(schema.uploads.venueId, venueId), eq(schema.uploads.id, body.upload_id)))
        .get()
      // Somebody else's upload id is not a picture you may post: without this a
      // guessed uuid would republish a photo into a channel its author never
      // chose.
      if (!upload || upload.createdBy !== actor.userId || upload.kind !== 'chat') {
        throw unprocessable('UPLOAD_NOT_YOURS', 'that upload is not yours to post')
      }
      uploadId = upload.id
    }

    let replyToId: string | null = null
    if (body.reply_to_id) {
      const quoted = tx.select().from(schema.chatMessages)
        .where(and(
          eq(schema.chatMessages.venueId, venueId),
          eq(schema.chatMessages.id, body.reply_to_id),
        ))
        .get()
      if (!quoted) throw notFound('MESSAGE_NOT_FOUND', `message ${body.reply_to_id} not found`)
      // The rule that stops a quoted first line carrying *Konobari* text into
      // *Svi*. A forward is the deliberate way to move a line between rooms, and
      // it says so on the bubble.
      if (quoted.channelId !== channel.id) {
        throw unprocessable('REPLY_CROSS_CHANNEL', 'a reply stays in its own channel')
      }
      replyToId = quoted.id
    }

    const clientAt = clampEventAt(body.client_created_at, now, settings.max_sync_lag_h)
    const row = insertMessage(tx, venueId, {
      channelId: channel.id,
      clientId: body.client_id,
      kind: body.kind,
      body: text || null,
      uploadId,
      replyToId,
      authorId: actor.userId,
      deviceId: actor.deviceId,
      clientCreatedAt: body.client_created_at ?? null,
      clientCreatedAtAdj: clientAt,
      createdAt: now,
    })

    /**
     * The money guard. It never blocks anything: PLAN §8 says nobody's pazar,
     * manjak or razlika belongs in *Svi* or *Konobari*, and the way that rule
     * is kept is a sheet on the phone and a quiet record here — not a refusal a
     * waiter would learn to route around by writing "šesto dvanaest".
     *
     * `money_ack` is what lets the Dnevnik tell "the sheet was shown and he sent
     * anyway" from "the sheet never appeared".
     */
    if (kind !== 'admini' && looksLikeMoney(text)) {
      log(tx, venueId, {
        kind: 'chat_money_warned',
        body: { user_id: actor.userId, channel: kind, money_ack: body.money_ack === true },
        actorId: actor.userId,
        deviceId: actor.deviceId,
        ref: { type: 'chat_message', id: row.id },
        at: now,
      })
    }

    bump(tx, venueId, 'chat', row.id)
    return { row, replayed: false }
  })

  const channels = allChannels(db, venueId)
  return {
    message: hydrate(db, venueId, [toWire(result.row, channels, nameMap(db, venueId))])[0]!,
    cursor: maxChatSeq(db, venueId),
    already_applied: result.replayed,
  }
}

/**
 * `POST /api/chat/messages/:id/delete` — a soft delete, once.
 *
 * Three doors, in order: the author of a `text` inside `chat_delete_own_s`; an
 * `admin` on anything in *Svi* or *Admini* at any age; and **any member of
 * *Konobari* on an `image`**, at any age — *Ukloni sliku*, because a photo of the
 * bar with somebody in it is the one thing the room has to be able to take down
 * without asking the owner.
 */
export function deleteMessage(
  db: Db, venueId: string, actor: Actor, id: string, now = nowIso(),
): void {
  db.transaction((tx) => {
    const row = tx.select().from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.venueId, venueId), eq(schema.chatMessages.id, id)))
      .get()
    if (!row) throw notFound('MESSAGE_NOT_FOUND', `message ${id} not found`)

    const channel = tx.select().from(schema.chatChannels)
      .where(eq(schema.chatChannels.id, row.channelId))
      .get()!
    const kind = channel.kind as ChannelKind

    // A forged channel id in the body cannot help: the channel comes from the
    // message, and this is the check.
    if (!canSee(actor.role, kind)) {
      throw forbidden('CHANNEL_FORBIDDEN', `${actor.role} may not open ${kind}`)
    }
    if (row.deletedAt) throw conflict('ALREADY_DECIDED', 'that message is already removed')
    if (row.kind === 'system') throw forbidden('DELETE_FORBIDDEN', 'a system line is not deletable')

    const settings = getSettings(tx, venueId)
    const isAuthor = row.authorId === actor.userId
    const ageS = (Date.parse(now) - Date.parse(row.createdAt)) / 1000

    const isImageInKonobari = kind === 'konobari' && row.kind === 'image'
    const adminMayModerate = actor.role === 'admin' && (kind === 'svi' || kind === 'admini')

    if (!isAuthor && !adminMayModerate && !isImageInKonobari) {
      throw forbidden('DELETE_FORBIDDEN', 'this message is not yours to remove')
    }
    if (isAuthor && !adminMayModerate && !isImageInKonobari && ageS > settings.chat_delete_own_s) {
      throw conflict('DELETE_WINDOW', 'the window for deleting your own message has passed')
    }

    tx.update(schema.chatMessages)
      .set({ deletedAt: now, deletedBy: actor.userId })
      .where(eq(schema.chatMessages.id, row.id))
      .run()

    // The file goes only when nothing else points at it. The count runs inside
    // this transaction, so a forwarded copy keeps the evidence alive after the
    // author deletes the original.
    if (row.uploadId) dropUploadIfUnreferenced(tx, venueId, row.uploadId, now)

    if (isImageInKonobari && !isAuthor) {
      log(tx, venueId, {
        kind: 'chat_image_removed',
        body: { author_id: row.authorId, remover_id: actor.userId, channel: kind },
        actorId: actor.userId,
        ref: { type: 'chat_message', id: row.id },
        at: now,
      })
    } else if (!isAuthor && actor.role === 'admin') {
      log(tx, venueId, {
        kind: 'chat_deleted_by_admin',
        body: { author_id: row.authorId, channel: kind },
        actorId: actor.userId,
        ref: { type: 'chat_message', id: row.id },
        at: now,
      })
    }

    bump(tx, venueId, 'chat', row.id)
  })
}

/**
 * `POST /api/chat/messages/:id/forward`.
 *
 * Staff forward *Konobari* → *Svi*, and *Konobari* or *Svi* → *Admini* — that last
 * one is *Prijavi vlasniku*, the single staff → *Admini* path in the app, and
 * the reason it exists is that an admin cannot read *Konobari* at all. Admins
 * forward *Svi* → *Admini*.
 */
export function forwardMessage(
  db: Db, venueId: string, actor: Actor, id: string, to: ChannelKind, now = nowIso(),
): PostMessageResult {
  const row = db.transaction((tx) => {
    const source = tx.select().from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.venueId, venueId), eq(schema.chatMessages.id, id)))
      .get()
    if (!source) throw notFound('MESSAGE_NOT_FOUND', `message ${id} not found`)

    const from = tx.select().from(schema.chatChannels)
      .where(eq(schema.chatChannels.id, source.channelId))
      .get()!
    const fromKind = from.kind as ChannelKind

    if (!canSee(actor.role, fromKind)) {
      throw forbidden('CHANNEL_FORBIDDEN', `${actor.role} may not open ${fromKind}`)
    }
    if (!mayForward(actor.role, fromKind, to)) {
      throw forbidden('FORWARD_FORBIDDEN', `${fromKind} may not be forwarded to ${to}`)
    }

    const target = requireChannel(tx, venueId, to)
    requireNotMuted(tx, venueId, actor, now)

    const author = source.authorId
      ? tx.select({ name: schema.users.name }).from(schema.users)
        .where(eq(schema.users.id, source.authorId)).get()?.name ?? 'Sistem'
      : 'Sistem'

    // "↪ Amar (Konobari, 22:41): " — a typographic character from the glossary,
    // not an emoji (PHASE4 §4).
    const prefix = `↪ ${author} (${CHANNEL_NAMES[fromKind]}, ${localTime(source.createdAt)}): `
    const carried = source.body ? `${prefix}${source.body}` : prefix.trimEnd()

    const created = insertMessage(tx, venueId, {
      channelId: target.id,
      clientId: newId(),
      kind: source.kind === 'image' ? 'image' : 'text',
      body: carried.slice(0, 2000),
      uploadId: source.uploadId,
      replyToId: null,
      forwardedFromId: source.id,
      authorId: actor.userId,
      deviceId: actor.deviceId,
      clientCreatedAt: null,
      clientCreatedAtAdj: null,
      createdAt: now,
    })

    bump(tx, venueId, 'chat', created.id)
    return created
  })

  return {
    message: hydrate(db, venueId, [toWire(row, allChannels(db, venueId), nameMap(db, venueId))])[0]!,
    cursor: maxChatSeq(db, venueId),
    already_applied: false,
  }
}

/**
 * `POST /api/chat/read` — the badge cursor, and the one chat write that
 * deliberately does **not** bump.
 *
 * A read cursor that invalidated every phone's ETag every few seconds would cost
 * the venue its 304s, which is the same reason the heartbeat is exempt (§2.11).
 * The tag carries the reader's own `MAX(last_read_seq)` instead, so his badge
 * still moves and nobody else's poll notices.
 */
export function markRead(
  db: Db, venueId: string, actor: Actor, kind: ChannelKind, seq: number, now = nowIso(),
): void {
  const channel = requireVisibleChannel(db, venueId, actor, kind)
  db.insert(schema.chatReads)
    .values({
      venueId,
      channelId: channel.id,
      userId: actor.userId,
      lastReadSeq: seq,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.chatReads.venueId, schema.chatReads.channelId, schema.chatReads.userId],
      // `max()`: two phones in one pocket must not walk the cursor backwards.
      set: {
        lastReadSeq: sql`max(${schema.chatReads.lastReadSeq}, ${seq})`,
        updatedAt: now,
      },
    })
    .run()
}

/**
 * `POST /api/chat/:channel/pin` — *Za naručiti*, and the two taps that keep it.
 *
 * `{ append }` is why this is not one textarea: the waiter who notices the ice is
 * gone taps *Dodaj u "Za naručiti"* on his own message and the note grows a
 * line, with no keyboard and no lost update. `{ text }` is the owner's tidy-up,
 * `{ cleared: true }` is *Naručeno ✓* and is his alone.
 */
export function setPin(
  db: Db, venueId: string, actor: Actor, kind: ChannelKind,
  body: { text: string } | { append: string } | { cleared: true }, now = nowIso(),
): void {
  db.transaction((tx) => {
    const channel = requireVisibleChannel(tx, venueId, actor, kind)

    let next: string | null
    let systemKey: string
    let line: string

    if ('cleared' in body) {
      if (actor.role !== 'admin') throw forbidden('PIN_CLEAR_FORBIDDEN', 'only an admin clears the note')
      next = null
      systemKey = 'pin_cleared'
      line = `${nameOf(tx, actor.userId)}: naručeno`
    } else if ('append' in body) {
      const added = body.append.trim().slice(0, 80)
      next = channel.pinnedText ? `${channel.pinnedText}\n${added}` : added
      if (next.length > 500) throw unprocessable('PIN_TOO_LONG', 'the note is at most 500 characters')
      systemKey = 'pin_changed'
      line = `${nameOf(tx, actor.userId)} je dopunio "Za naručiti"`
    } else {
      const text = body.text.trim()
      if (text.length > 500) throw unprocessable('PIN_TOO_LONG', 'the note is at most 500 characters')
      next = text.length > 0 ? text : null
      systemKey = 'pin_changed'
      line = `${nameOf(tx, actor.userId)} je promijenio "Za naručiti"`
    }

    tx.update(schema.chatChannels)
      .set({ pinnedText: next, pinnedBy: actor.userId, pinnedAt: now })
      .where(eq(schema.chatChannels.id, channel.id))
      .run()

    // The column is the current note; the thread keeps every version of it.
    postSystem(tx, venueId, kind, systemKey, line, undefined, now)

    log(tx, venueId, {
      kind: 'chat_pin_changed',
      body: { user_id: actor.userId, channel: kind, cleared: 'cleared' in body },
      actorId: actor.userId,
      ref: { type: 'chat_channel', id: channel.id },
      at: now,
    })

    bump(tx, venueId, 'chat', channel.id)
  })
}

/** `POST /api/chat/users/:id/mute` — *Utišaj*, with an until-time picker. */
export function muteUser(
  db: Db, venueId: string, actor: Actor, userId: string, until: string | null, now = nowIso(),
): void {
  db.transaction((tx) => {
    const target = tx.select().from(schema.users)
      .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, userId)))
      .get()
    if (!target) throw notFound('USER_NOT_FOUND', `user ${userId} not found`)

    tx.update(schema.users)
      .set({ chatMutedUntil: until })
      .where(eq(schema.users.id, userId))
      .run()

    log(tx, venueId, {
      kind: 'chat_muted',
      body: { user_id: userId, until },
      actorId: actor.userId,
      ref: { type: 'user', id: userId },
      at: now,
    })

    bump(tx, venueId, 'chat', userId)
    // `user`, so the muted phone's own `/api/me` refreshes on its next poll.
    bump(tx, venueId, 'user', userId)
  })
}

/**
 * The one way the system speaks in a channel.
 *
 * Takes a `Tx`, so it always runs inside its caller's transaction — a "Raspored
 * je objavljen" line that survived a rolled-back publish would be the system
 * lying about itself.
 *
 * **It throws on money outside *Admini*.** A waiter's settlement is a Dnevnik
 * entry for admins, never a chat line, and the check is on the payload's key
 * names because that is the shape a careless caller spreads a row into.
 */
export function postSystem(
  tx: Tx, venueId: string, kind: ChannelKind, systemKey: string, text: string,
  payload?: SystemPayload, now = nowIso(),
): void {
  if (kind !== 'admini' && payload) {
    const money = Object.keys(payload).find(k => /_fen$/.test(k))
    if (money) {
      throw new SankError(
        500, 'SYSTEM_MONEY_LEAK', `system payload key "${money}" may not reach ${kind}`,
      )
    }
  }

  const channel = requireChannel(tx, venueId, kind)
  insertMessage(tx, venueId, {
    channelId: channel.id,
    clientId: newId(),
    kind: 'system',
    body: text,
    uploadId: null,
    replyToId: null,
    authorId: null,
    deviceId: null,
    systemKey,
    systemPayloadJson: payload ? JSON.stringify(payload) : null,
    clientCreatedAt: null,
    clientCreatedAtAdj: null,
    createdAt: now,
  })
}

/**
 * The three rooms, seeded with the venue. Called by `seed()` and by anything
 * that has to be sure they exist before it posts a system line.
 */
export function ensureChannels(tx: Tx, venueId: string, now: string): void {
  for (const kind of ['svi', 'konobari', 'admini'] as ChannelKind[]) {
    tx.insert(schema.chatChannels).values({
      id: newId(),
      venueId,
      kind,
      name: CHANNEL_NAMES[kind],
      createdAt: now,
    }).onConflictDoNothing().run()
  }
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/** Which forwards exist. Anything not on this list is a `403 FORWARD_FORBIDDEN`. */
function mayForward(role: Actor['role'], from: ChannelKind, to: ChannelKind): boolean {
  if (from === to) return false
  if (role === 'admin') return from === 'svi' && to === 'admini'
  // Staff. *Prijavi vlasniku* is the `→ admini` half and is the only way a line
  // written in *Konobari* ever reaches the owner.
  if (from === 'konobari') return to === 'svi' || to === 'admini'
  if (from === 'svi') return to === 'admini'
  return false
}

function insertMessage(tx: Tx, venueId: string, values: {
  channelId: string
  clientId: string
  kind: 'text' | 'image' | 'system'
  body: string | null
  uploadId: string | null
  replyToId: string | null
  forwardedFromId?: string | null
  authorId: string | null
  deviceId: string | null
  systemKey?: string | null
  systemPayloadJson?: string | null
  clientCreatedAt: string | null
  clientCreatedAtAdj: string | null
  createdAt: string
}): MessageRow {
  // `MAX(seq)+1` inside the transaction, exactly like `orders.shift_seq`. One
  // writer at a time on one SQLite file, so this cannot interleave.
  const top = tx.select({ max: sql<number | null>`max(${schema.chatMessages.seq})` })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.venueId, venueId))
    .get()?.max ?? 0

  const id = newId()
  tx.insert(schema.chatMessages).values({
    id,
    venueId,
    channelId: values.channelId,
    clientId: values.clientId,
    seq: top + 1,
    kind: values.kind,
    body: values.body,
    uploadId: values.uploadId,
    replyToId: values.replyToId,
    forwardedFromId: values.forwardedFromId ?? null,
    authorId: values.authorId,
    deviceId: values.deviceId,
    systemKey: values.systemKey ?? null,
    systemPayloadJson: values.systemPayloadJson ?? null,
    clientCreatedAt: values.clientCreatedAt,
    clientCreatedAtAdj: values.clientCreatedAtAdj,
    createdAt: values.createdAt,
  }).run()

  return tx.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, id)).get()!
}

function dropUploadIfUnreferenced(tx: Tx, venueId: string, uploadId: string, at: string): void {
  const alive = tx.select({ n: sql<number>`count(*)` })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.venueId, venueId),
      eq(schema.chatMessages.uploadId, uploadId),
      isNull(schema.chatMessages.deletedAt),
    ))
    .get()?.n ?? 0
  if (alive > 0) return

  const upload = tx.select().from(schema.uploads)
    .where(and(eq(schema.uploads.venueId, venueId), eq(schema.uploads.id, uploadId)))
    .get()
  if (upload && !upload.deletedAt) unlinkUpload(tx, venueId, upload.id, upload.path, at)
}

function requireChannel(q: Queryable, venueId: string, kind: ChannelKind): ChannelRow {
  const row = q.select().from(schema.chatChannels)
    .where(and(eq(schema.chatChannels.venueId, venueId), eq(schema.chatChannels.kind, kind)))
    .get()
  if (!row) throw notFound('CHANNEL_NOT_FOUND', `channel ${kind} not found`)
  return row
}

function requireVisibleChannel(
  q: Queryable, venueId: string, actor: Actor, kind: ChannelKind,
): ChannelRow {
  if (!canSee(actor.role, kind)) {
    throw forbidden('CHANNEL_FORBIDDEN', `${actor.role} may not open ${kind}`)
  }
  return requireChannel(q, venueId, kind)
}

function requireNotMuted(q: Queryable, venueId: string, actor: Actor, now: string): void {
  const until = mutedUntil(q, venueId, actor.userId)
  if (until && Date.parse(until) > Date.parse(now)) {
    throw forbidden('MUTED', `muted until ${until}`, { until, until_time: localTime(until) })
  }
}

function mutedUntil(q: Queryable, venueId: string, userId: string): string | null {
  const row = q.select({ until: schema.users.chatMutedUntil }).from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, userId)))
    .get()
  return row?.until ?? null
}

function allChannels(q: Queryable, venueId: string): ChannelRow[] {
  return q.select().from(schema.chatChannels)
    .where(eq(schema.chatChannels.venueId, venueId))
    .all()
}

function visibleChannels(q: Queryable, venueId: string, actor: Actor): ChannelRow[] {
  const ids = new Set(visibleChannelIds(q, venueId, actor))
  return allChannels(q, venueId)
    .filter(c => ids.has(c.id))
    .sort((a, b) => order(a.kind) - order(b.kind))
}

function order(kind: string): number {
  return kind === 'svi' ? 0 : kind === 'konobari' ? 1 : 2
}

export function maxChatSeq(q: Queryable, venueId: string): number {
  const row = q.select({ max: sql<number | null>`max(${schema.chatMessages.seq})` })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.venueId, venueId))
    .get()
  return row?.max ?? 0
}

function lastSeqOf(q: Queryable, venueId: string, channelId: string): number {
  const row = q.select({ max: sql<number | null>`max(${schema.chatMessages.seq})` })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.venueId, venueId),
      eq(schema.chatMessages.channelId, channelId),
    ))
    .get()
  return row?.max ?? 0
}

/**
 * The badge. `text` and `image` only — a system line is shown in the thread and
 * never bumps a badge, so the number means "a person wrote something". Own
 * messages are excluded for the same reason: nobody is unread on himself.
 */
function unreadOf(q: Queryable, venueId: string, actor: Actor, channelId: string): number {
  const read = q.select({ seq: schema.chatReads.lastReadSeq }).from(schema.chatReads)
    .where(and(
      eq(schema.chatReads.venueId, venueId),
      eq(schema.chatReads.channelId, channelId),
      eq(schema.chatReads.userId, actor.userId),
    ))
    .get()?.seq ?? 0

  return q.select({ n: sql<number>`count(*)` })
    .from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.venueId, venueId),
      eq(schema.chatMessages.channelId, channelId),
      gt(schema.chatMessages.seq, read),
      inArray(schema.chatMessages.kind, ['text', 'image']),
      isNull(schema.chatMessages.deletedAt),
      sql`${schema.chatMessages.authorId} is not ${actor.userId}`,
    ))
    .get()?.n ?? 0
}

function channelView(
  q: Queryable, venueId: string, actor: Actor, c: ChannelRow,
): ChatChannelView {
  const last = q.select().from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.venueId, venueId),
      eq(schema.chatMessages.channelId, c.id),
      inArray(schema.chatMessages.kind, ['text', 'image']),
      isNull(schema.chatMessages.deletedAt),
    ))
    .orderBy(desc(schema.chatMessages.seq))
    .limit(1)
    .get()

  return {
    id: c.id,
    kind: c.kind as ChannelKind,
    name: c.name,
    unread: unreadOf(q, venueId, actor, c.id),
    last_seq: lastSeqOf(q, venueId, c.id),
    preview: last ? (last.kind === 'image' && !last.body ? 'Slika' : last.body) : null,
    preview_at: last?.createdAt ?? null,
    pinned_text: c.pinnedText,
    pinned_at: c.pinnedAt,
    members: members(q, venueId, c.kind as ChannelKind),
  }
}

/** Everyone the matrix admits, by name — the room is visible to the people in it. */
function members(q: Queryable, venueId: string, kind: ChannelKind): string[] {
  return q.select({ name: schema.users.name, role: schema.users.role })
    .from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .orderBy(asc(schema.users.name))
    .all()
    .filter(u => canSee(u.role, kind))
    .map(u => u.name)
}

interface Names {
  name: (id: string | null) => string | null
  initials: (id: string | null) => string | null
}

function nameMap(q: Queryable, venueId: string): Names {
  const rows = q.select({
    id: schema.users.id, name: schema.users.name, initials: schema.users.initials,
  }).from(schema.users).where(eq(schema.users.venueId, venueId)).all()
  const byId = new Map(rows.map(r => [r.id, r] as const))
  return {
    name: id => (id ? byId.get(id)?.name ?? null : null),
    initials: id => (id ? byId.get(id)?.initials ?? null : null),
  }
}

function nameOf(q: Queryable, userId: string): string {
  return q.select({ name: schema.users.name }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.name ?? 'Sistem'
}

/**
 * A row on the wire.
 *
 * A soft-deleted message keeps its body in the database — moderation evidence —
 * and loses it **here**: the bubble shows who removed it and when, never the
 * text. That is the one place the two differ, and it is deliberate.
 */
function toWire(row: MessageRow, channels: ChannelRow[], names: Names): ChatMessage {
  const channel = channels.find(c => c.id === row.channelId)
  const deleted = row.deletedAt !== null

  return {
    id: row.id,
    client_id: row.clientId,
    channel: (channel?.kind ?? 'svi') as ChannelKind,
    seq: row.seq,
    kind: row.kind,
    body: deleted ? null : row.body,
    image: !deleted && row.uploadId
      ? {
          upload_id: row.uploadId,
          url: `/api/uploads/${row.uploadId}`,
          width: 0,
          height: 0,
          expired: false,
        }
      : null,
    author_id: row.authorId,
    author_name: names.name(row.authorId),
    author_initials: names.initials(row.authorId),
    reply_to_id: row.replyToId,
    reply_preview: null,
    forwarded_from_id: row.forwardedFromId,
    system_key: row.systemKey,
    system_payload: row.systemPayloadJson
      ? JSON.parse(row.systemPayloadJson) as SystemPayload
      : null,
    at: row.createdAt,
    deleted_at: row.deletedAt,
    deleted_by_name: names.name(row.deletedBy),
  }
}

/** Both joins, in the order the wire needs them. */
function hydrate(q: Queryable, venueId: string, messages: ChatMessage[]): ChatMessage[] {
  return hydrateReplies(q, venueId, hydrateImages(q, venueId, messages))
}

/** The image dimensions and the "Slika istekla" flag, joined in one pass. */
export function hydrateImages(q: Queryable, venueId: string, messages: ChatMessage[]): ChatMessage[] {
  const ids = messages.map(m => m.image?.upload_id).filter((v): v is string => Boolean(v))
  if (ids.length === 0) return messages

  const rows = q.select().from(schema.uploads)
    .where(and(eq(schema.uploads.venueId, venueId), inArray(schema.uploads.id, ids)))
    .all()
  const byId = new Map(rows.map(r => [r.id, r] as const))

  for (const m of messages) {
    if (!m.image) continue
    const upload = byId.get(m.image.upload_id)
    if (!upload) continue
    m.image.width = upload.width
    m.image.height = upload.height
    m.image.expired = upload.deletedAt !== null
  }
  return messages
}

/** The quoted first line a reply renders, ≤ 80 characters, joined in one pass. */
export function hydrateReplies(q: Queryable, venueId: string, messages: ChatMessage[]): ChatMessage[] {
  const ids = messages.map(m => m.reply_to_id).filter((v): v is string => Boolean(v))
  if (ids.length === 0) return messages

  const rows = q.select({
    id: schema.chatMessages.id,
    body: schema.chatMessages.body,
    kind: schema.chatMessages.kind,
    deletedAt: schema.chatMessages.deletedAt,
  }).from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.venueId, venueId), inArray(schema.chatMessages.id, ids)))
    .all()
  const byId = new Map(rows.map(r => [r.id, r] as const))

  for (const m of messages) {
    if (!m.reply_to_id) continue
    const quoted = byId.get(m.reply_to_id)
    if (!quoted) continue
    m.reply_preview = quoted.deletedAt
      ? 'Poruka uklonjena'
      : (quoted.kind === 'image' && !quoted.body ? 'Slika' : (quoted.body ?? '').slice(0, 80))
  }
  return messages
}
