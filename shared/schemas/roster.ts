/**
 * *Raspored* — the bodies (PHASE4 §2.7, §2.10).
 *
 * A `work_date` is a plain `YYYY-MM-DD` the owner picked, not one of the three
 * timestamps a phone may send (BACKEND §2): there is no instant in it and
 * nothing for `clampEventAt` to clamp.
 */
import { z } from 'zod'
import { shortNote, uuid } from './common'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const hhmm = z.string().regex(/^\d{2}:\d{2}$/)
/** `YYYY-MM` — the month picker on *Sati*. */
export const isoMonth = z.string().regex(/^\d{4}-\d{2}$/)

export const weekBody = z.object({ week_start: isoDate })

export const assignmentBody = z.object({
  work_date: isoDate,
  template_id: uuid,
  user_id: uuid,
  /**
   * The retry after a `409 DOUBLE_SHIFT`, asked once — the sheet is
   * *Dupla smjena — svejedno dodaj*. `409 OVERLAP` has no override.
   */
  force_double: z.boolean().optional(),
  note: shortNote.optional(),
})

/**
 * Status and note only, and never by staff: a waiter's sickness enters through
 * one door, *Traži zamjenu* with reason `bolest`.
 */
export const assignmentPatch = z.object({
  status: z.enum(['planned', 'sick', 'absent', 'removed']).optional(),
  note: shortNote.nullable().optional(),
}).refine(b => b.status !== undefined || b.note !== undefined, {
  message: 'nothing to change',
})

export const swapBody = z.object({
  assignment_id: uuid,
  /** A named colleague, or absent for an open offer anybody may take. */
  to_user_id: uuid.optional(),
  reason: z.enum(['zamjena', 'bolest']),
  note: shortNote.optional(),
})

export const decideSwapBody = z.object({
  to_user_id: uuid.optional(),
  force_double: z.boolean().optional(),
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

export type WeekBody = z.infer<typeof weekBody>
export type AssignmentBody = z.infer<typeof assignmentBody>
export type AssignmentPatch = z.infer<typeof assignmentPatch>
export type SwapBody = z.infer<typeof swapBody>
export type DecideSwapBody = z.infer<typeof decideSwapBody>
export type ShiftTemplateBody = z.infer<typeof shiftTemplateBody>
export type ShiftTemplatePatch = z.infer<typeof shiftTemplatePatch>
