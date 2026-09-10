/**
 * *Pravila* — the published house rules, versioned (PHASE4 §2.8, PLAN §8).
 *
 * **The ack gate is a client rule, not a server refusal.** Nothing here 403s an
 * order because a waiter has not read v3: refusing to record a round the guest
 * is already drinking would put money outside the ledger, which is the one thing
 * this app exists to prevent. The gate is the S12 screen standing in front of S1
 * at the next login, and the evidence is the `rules_acked` entry with its time.
 *
 * The text itself is deliberately a stored document rather than a page in the
 * code: the thresholds inside it are interpolated from `me.venue.settings` on
 * the phone, so an owner who changes the cash tolerance does not leave *Pravila*
 * lying — that is the whole point of publishing them.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { schema } from '../database/client'
import { newId, nowIso } from '../utils/ids'
import { conflict, notFound } from '../utils/errors'
import type { PublishRulesBody, RuleAck, RuleVersion, RulesView } from '#shared/types'
import type { Actor, Db, Queryable } from './types'
import { bump } from './changes'
import { log } from './log'
import { postSystem } from './chat'

/** `GET /api/rules` — the latest version and whether this reader owes an ack. */
export function latestRules(q: Queryable, venueId: string, actor: Actor): RulesView {
  const row = currentVersion(q, venueId)
  const me = q.select({
    version: schema.users.rulesVersion,
    at: schema.users.rulesAckAt,
  }).from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, actor.userId)))
    .get()

  const myVersion = me?.version ?? 0

  return {
    version: row?.version ?? 0,
    body_md: row?.bodyMd ?? '',
    published_at: row?.publishedAt ?? null,
    published_by_name: row ? nameOf(q, row.publishedBy) : null,
    my_ack_version: myVersion,
    my_ack_at: me?.at ?? null,
    // Nothing published means nothing to acknowledge — a fresh venue does not
    // stand a gate in front of its first order.
    must_ack: row !== null && myVersion < row.version,
  }
}

/** `GET /api/admin/rules` — every version, with the current one's acknowledgements. */
export function listRuleVersions(q: Queryable, venueId: string): RuleVersion[] {
  const rows = q.select().from(schema.rules)
    .where(eq(schema.rules.venueId, venueId))
    .orderBy(desc(schema.rules.version))
    .all()

  return rows.map((row, index) => {
    const view: RuleVersion = {
      id: row.id,
      version: row.version,
      body_md: row.bodyMd,
      published_at: row.publishedAt,
      published_by_name: nameOf(q, row.publishedBy),
    }
    // Only the current version carries the list: "who has read the rules we are
    // actually under" is the question, and an old version's list is noise.
    if (index === 0) view.acks = acksFor(q, venueId, row.version)
    return view
  })
}

/**
 * `POST /api/admin/rules` — a new version, and one *Svi* line.
 *
 * Append-only: `rules_no_update` refuses an edit, so a correction is v4 and the
 * question "what did the rules say when Amar acknowledged them?" stays a row.
 */
export function publishRules(
  db: Db, venueId: string, actor: Actor, body: PublishRulesBody, now = nowIso(),
): RulesView {
  db.transaction((tx) => {
    const top = tx.select({ max: sql<number | null>`max(${schema.rules.version})` })
      .from(schema.rules)
      .where(eq(schema.rules.venueId, venueId))
      .get()?.max ?? 0

    const version = top + 1
    tx.insert(schema.rules).values({
      id: newId(),
      venueId,
      version,
      bodyMd: body.body_md,
      publishedAt: now,
      publishedBy: actor.userId,
    }).run()

    postSystem(tx, venueId, 'svi', 'rules_published',
      `Objavljena su nova Pravila (v${version})`,
      { link: { label: 'Pravila →', route: '/k/pravila' }, version }, now)

    log(tx, venueId, {
      kind: 'rules_published',
      body: { version, chars: body.body_md.length },
      actorId: actor.userId,
      ref: { type: 'rules', id: String(version) },
      at: now,
    })

    bump(tx, venueId, 'rules', String(version))
    bump(tx, venueId, 'chat')
  })

  return latestRules(db, venueId, actor)
}

/** `POST /api/me/rules/ack` — *Potvrđujem*, once per version. */
export function ackRules(
  db: Db, venueId: string, actor: Actor, version: number, now = nowIso(),
): RulesView {
  db.transaction((tx) => {
    const current = currentVersion(tx, venueId)
    if (!current) throw notFound('RULES_NOT_PUBLISHED', 'nothing has been published yet')
    // Acknowledging yesterday's text is not acknowledging today's.
    if (version !== current.version) {
      throw conflict('RULES_STALE', `v${version} is not the current version (v${current.version})`)
    }

    tx.update(schema.users)
      .set({ rulesAckAt: now, rulesVersion: version })
      .where(and(eq(schema.users.venueId, venueId), eq(schema.users.id, actor.userId)))
      .run()

    log(tx, venueId, {
      kind: 'rules_acked',
      body: { user_id: actor.userId, version },
      actorId: actor.userId,
      ref: { type: 'rules', id: String(version) },
      at: now,
    })

    bump(tx, venueId, 'rules', String(version))
    // `user`, so the owner's *Pravila* screen sees the acknowledgement arrive.
    bump(tx, venueId, 'user', actor.userId)
  })

  return latestRules(db, venueId, actor)
}

/** The version number `GET /api/changes` carries, so the gate re-evaluates. */
export function rulesVersion(q: Queryable, venueId: string): number {
  return currentVersion(q, venueId)?.version ?? 0
}

function currentVersion(q: Queryable, venueId: string): typeof schema.rules.$inferSelect | null {
  return q.select().from(schema.rules)
    .where(eq(schema.rules.venueId, venueId))
    .orderBy(desc(schema.rules.version))
    .limit(1)
    .get() ?? null
}

function acksFor(q: Queryable, venueId: string, version: number): RuleAck[] {
  return q.select({
    id: schema.users.id,
    name: schema.users.name,
    version: schema.users.rulesVersion,
    at: schema.users.rulesAckAt,
  }).from(schema.users)
    .where(and(eq(schema.users.venueId, venueId), eq(schema.users.active, 1)))
    .all()
    .map(u => ({
      user_id: u.id,
      user_name: u.name,
      version: u.version,
      // Somebody on an older version shows as not yet acknowledged, which is
      // exactly what the owner needs to see.
      at: u.version === version ? u.at : null,
    }))
}

function nameOf(q: Queryable, userId: string): string {
  return q.select({ name: schema.users.name }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.name ?? 'Sistem'
}
