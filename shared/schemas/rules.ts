/**
 * *Pravila* — the two bodies (PHASE4 §2.8).
 *
 * `body_md` is markdown-ish (headings, lists, bold) rendered by a ~40-line
 * renderer with **no library and no raw HTML**, because this text is published
 * to every phone in the building.
 */
import { z } from 'zod'

export const publishRulesBody = z.object({
  body_md: z.string().trim().min(20).max(40_000),
})

/** Acknowledging an old version is `409 RULES_STALE` — the service checks it. */
export const ackRulesBody = z.object({
  version: z.int().min(1),
})

export type PublishRulesBody = z.infer<typeof publishRulesBody>
export type AckRulesBody = z.infer<typeof ackRulesBody>
