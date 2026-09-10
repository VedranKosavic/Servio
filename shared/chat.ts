/**
 * *Razgovor* — the access matrix and the money guard (PLAN F12 (a), §8).
 *
 * Two pure functions, and they are the whole of chat authorization. Every read,
 * every write, every quote and every image URL asks `canSee` — not the channel
 * list only, and never a filter applied *after* the rows were selected. The
 * difference matters: a `WHERE channel_id IN (…)` built from this function
 * cannot leak a row a later `.filter()` forgot.
 *
 * There is no i18n layer in Šank (CLAUDE.md), so the three channel kinds are
 * Bosnian words used as values. `svi` / `konobari` / `admini` are what the
 * glossary (PLAN §12) calls them and what the URL says.
 */
import type { Role } from './types'

export type ChannelKind = 'svi' | 'konobari' | 'admini'

export const CHANNEL_KINDS: ChannelKind[] = ['svi', 'konobari', 'admini']

/** The Bosnian name of each channel, as it is seeded and as every screen prints it. */
export const CHANNEL_NAMES: Record<ChannelKind, string> = {
  svi: 'Svi',
  konobari: 'Konobari',
  admini: 'Admini',
}

/**
 * PLAN F12 (a). Three rows × three columns, and nothing else decides access.
 *
 * | role      | Svi | Konobari | Admini |
 * |-----------|-----|----------|--------|
 * | admin     | yes | **no**   | yes    |
 * | bartender | yes | yes      | no     |
 * | waiter    | yes | yes      | no     |
 *
 * The šanker is staff. The owner never sees *Konobari* in the app — that is a
 * server-enforced rule and a *Pravila* promise, and CLAUDE.md's "Konobari is
 * private" is this table.
 */
export function canSee(role: Role, kind: ChannelKind): boolean {
  if (kind === 'svi') return true
  if (kind === 'konobari') return role === 'waiter' || role === 'bartender'
  return role === 'admin'
}

/** Every channel this role may open, in the order the screens list them. */
export function visibleChannels(role: Role): ChannelKind[] {
  return CHANNEL_KINDS.filter(kind => canSee(role, kind))
}

/** Is this string one of the three kinds? Guards a `:channel` route param. */
export function isChannelKind(value: string): value is ChannelKind {
  return (CHANNEL_KINDS as string[]).includes(value)
}

/**
 * Does this line look like somebody's money?
 *
 * The composer's confirm sheet (WP1) and the server's quiet `chat_money_warned`
 * entry ask exactly this question, which is why it lives in `shared/`. It never
 * blocks anything: PLAN §8 says nobody's pazar, manjak or razlika belongs in
 * *Svi* or *Konobari*, and the way that rule is kept is a sheet and a record,
 * not a refusal a waiter would learn to route around.
 */
export function looksLikeMoney(text: string | null | undefined): boolean {
  if (!text) return false
  return /\d+[,.]\d{2}\s*KM/i.test(text)
    || /(očekivano|manjak|razlika|predao|pazar)/i.test(text)
}
