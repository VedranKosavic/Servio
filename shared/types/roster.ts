/**
 * *Raspored* — the shapes `server/services/roster.ts` answers with.
 *
 * **One weekly pattern, no dates.** The owner's rule (2026-09-15): "Ne trebaju
 * nam datumi za raspored, samo nam treba da dodamo po danima maksimalno 2 osobe
 * po smjeni i taj raspored ostaje zauvijek." So the plan is seven weekdays ×
 * the active shift templates, at most `max_per_shift` people in each cell, and
 * an edit applies to every week from the moment it is saved. There is nothing
 * to publish and nothing to copy.
 *
 * The owner and staff read the same shape: with no sick days and no swaps left
 * there is nothing on a pattern row a colleague may not see.
 */

export interface ShiftTemplateView {
  id: string
  name: string
  start_time: string
  end_time: string
  sort: number
  active: boolean
}

/** One person in one cell of the pattern. */
export interface PatternEntry {
  /** The `roster_pattern` row — what `DELETE /api/roster/pattern/:id` takes. */
  id: string
  /** ISO weekday, Monday = 1 … Sunday = 7. */
  weekday: number
  template_id: string
  user_id: string
  user_name: string
  user_initials: string
}

/**
 * `GET /api/roster/pattern` (owner) and `GET /api/me/roster` (staff).
 *
 * `templates` are the **active** ones in their own `sort` order; `entries` only
 * ever name active people on active templates — a deactivated person or
 * template simply stops showing.
 */
export interface RosterPatternView {
  templates: ShiftTemplateView[]
  entries: PatternEntry[]
  /** The server's cap, so a screen hides its `+` at the same number it refuses. */
  max_per_shift: number
}
