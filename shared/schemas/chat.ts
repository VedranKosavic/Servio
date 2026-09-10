/**
 * *Razgovor* — the bodies (PHASE4 §2.5, §2.10).
 *
 * Nothing here names an actor and nothing here names a channel id: the channel
 * is the `:channel` path segment, one of the three kinds, and `canSee` decides
 * the rest. A forged channel id in a body cannot reach a query, because no body
 * below has a place to put one.
 */
import { z } from 'zod'
import { clientAt, uuid } from './common'
import { CHANNEL_KINDS } from '../chat'

export const channelKind = z.enum(CHANNEL_KINDS as [string, ...string[]])

/** ≤ 2000 chars — a message, not a document. An image may carry a caption here. */
export const messageBody = z.string().trim().min(1).max(2000)

export const postMessageBody = z.object({
  client_id: uuid,
  kind: z.enum(['text', 'image']),
  body: messageBody.optional(),
  upload_id: uuid.optional(),
  reply_to_id: uuid.optional(),
  /**
   * The composer's confirm sheet was shown and the author sent anyway. Recorded
   * in the `chat_money_warned` entry so the Dnevnik can tell that apart from
   * "the sheet never appeared" (PHASE4 §2.5).
   */
  money_ack: z.boolean().optional(),
  client_created_at: clientAt.optional(),
})

/**
 * *Za naručiti*. Exactly one of the three shapes, which is what
 * `z.union` buys over three optional keys that could all arrive at once.
 */
export const setPinBody = z.union([
  z.object({ text: z.string().trim().max(500) }).strict(),
  z.object({ append: z.string().trim().min(1).max(80) }).strict(),
  z.object({ cleared: z.literal(true) }).strict(),
])

export const forwardMessageBody = z.object({ to: channelKind })

export const markReadBody = z.object({
  channel: channelKind,
  seq: z.int().min(0),
})

/** `{ until }` is an ISO instant; `null` lifts the mute. */
export const muteUserBody = z.object({
  until: z.iso.datetime().nullable(),
})

export type PostMessageBody = z.infer<typeof postMessageBody>
export type SetPinBody = z.infer<typeof setPinBody>
export type ForwardMessageBody = z.infer<typeof forwardMessageBody>
export type MarkReadBody = z.infer<typeof markReadBody>
export type MuteUserBody = z.infer<typeof muteUserBody>
