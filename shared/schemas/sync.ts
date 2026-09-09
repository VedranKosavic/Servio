/**
 * WP5's bodies (`docs/BACKEND.md` §4.3). One fragment per package, re-exported
 * by the barrel in `shared/schemas.ts`, so two branches never edit one file.
 */
import { z } from 'zod'

/**
 * What a phone reports about itself every 60 s.
 *
 * `pending` is the length of its offline outbox and `client_now` is its own
 * clock. Both are **claims**: the server stores them as evidence (§4.3) and
 * measures the clock skew from the second one, but neither is ever the only
 * control — the post-settlement rule in §6.4 exists precisely because a phone
 * can lie about its outbox.
 */
export const heartbeatBody = z.object({
  pending: z.int().min(0).max(10_000),
  oldest_pending_at: z.iso.datetime().optional(),
  client_now: z.iso.datetime(),
  app_version: z.string().max(40).optional(),
  standalone: z.boolean().optional(),
})

export type HeartbeatBody = z.infer<typeof heartbeatBody>

/** `POST /api/owner/log/seen` — the Dnevnik badge takes no arguments. */
export const logSeenBody = z.object({}).loose()
