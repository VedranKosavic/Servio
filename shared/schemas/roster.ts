/**
 * *Raspored* — the bodies.
 *
 * The roster is one weekly pattern with no dates in it, so a cell is named by an
 * ISO weekday (Monday = 1 … Sunday = 7) and a shift template, never by a date.
 */
import { z } from 'zod'
import { uuid } from './common'

export const hhmm = z.string().regex(/^\d{2}:\d{2}$/)

/** `POST /api/roster/pattern` — one person into one cell of the week. */
export const patternBody = z.object({
  weekday: z.int().min(1).max(7),
  template_id: uuid,
  user_id: uuid,
})

export const shiftTemplateBody = z.object({
  name: z.string().trim().min(1).max(40),
  start_time: hhmm,
  end_time: hhmm,
  sort: z.int().min(0).max(999).optional(),
})

export const shiftTemplatePatch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  start_time: hhmm.optional(),
  end_time: hhmm.optional(),
  sort: z.int().min(0).max(999).optional(),
  active: z.boolean().optional(),
})

export type PatternBody = z.infer<typeof patternBody>
export type ShiftTemplateBody = z.infer<typeof shiftTemplateBody>
export type ShiftTemplatePatch = z.infer<typeof shiftTemplatePatch>
