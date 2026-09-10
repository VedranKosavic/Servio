/**
 * *Raspored* — the shapes `server/services/roster.ts` answers with (PHASE4 §2.7).
 *
 * **The staff projection is a different query, not a filter** (§2.7). A waiter's
 * response object never held a colleague's `sick` and then dropped it: `note`,
 * `updated_by` and `swap_request_id` are simply not selected, and a colleague's
 * `sick | absent | removed` row is mapped to a hole before it becomes an
 * `Assignment` at all. The optional fields below are what an admin gets extra.
 */
export type AssignmentStatus = 'planned' | 'swapped' | 'sick' | 'absent' | 'removed'
export type AssignmentOrigin = 'owner' | 'copy' | 'swap'
export type SwapReason = 'zamjena' | 'bolest'
export type SwapStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

export interface ShiftTemplateView {
  id: string
  name: string
  start_time: string
  end_time: string
  sort: number
  active: boolean
}

export interface Assignment {
  id: string
  work_date: string
  template_id: string
  template_name: string
  /** Snapshotted at insert: the grid shows "16–01 (staro 15–00)" from these. */
  start_time: string
  end_time: string
  user_id: string
  user_name: string
  user_initials: string
  status: AssignmentStatus
  origin: AssignmentOrigin
  /** Admin only. */
  note?: string | null
  /** Admin only — the "izmijenjeno 10.09. · Haris" chip. */
  updated_by_name?: string | null
  updated_at?: string | null
  /** Admin only: the live request on this row, if any. */
  swap_request_id?: string | null
  /** True on a row with a `pending` request — the amber chip, on both sides. */
  swap_pending: boolean
}

export interface RosterDayView {
  work_date: string
  assignments: Assignment[]
}

export interface RosterWeekView {
  week_start: string
  published_at: string | null
  published_by_name: string | null
  days: RosterDayView[]
  /** The templates this week's grid draws rows for. */
  templates: ShiftTemplateView[]
}

/** One open offer or one of my own requests, as S17's top cards draw it. */
export interface SwapRequestView {
  id: string
  assignment_id: string
  work_date: string
  template_name: string
  start_time: string
  end_time: string
  from_user_id: string
  from_user_name: string
  to_user_id: string | null
  to_user_name: string | null
  status: SwapStatus
  /** Admin only — *Zamjene* is the one screen besides *Dnevnik* that says "bolest". */
  reason?: SwapReason
  note?: string | null
  decided_by_name?: string | null
  decided_at?: string | null
  at: string
}

/** `GET /api/me/roster` — my week, the offers awaiting me, and my own requests. */
export interface MyRoster {
  this_week: RosterWeekView
  next_week: RosterWeekView
  /** Open offers and offers named at me. */
  offers: SwapRequestView[]
  /** My own live requests, each with its *Povuci*. */
  mine: SwapRequestView[]
}

/**
 * One person, one month, on *Sati*.
 *
 * `first_action` is not the arrival, and the page prints that sentence rather
 * than hiding it in a tooltip (PLAN §8): "prva tura 16:40 (+40 min)" is evidence
 * for a conversation, never a flag.
 */
export interface HoursRow {
  user_id: string
  user_name: string
  planned_shifts: number
  planned_h: number
  worked_h: number
  late_min: number
  early_leave_min: number
  sick_days: number
  absent_days: number
  swaps_given: number
  swaps_taken: number
  /** A `planned` row with no `shift_members` row behind it. */
  no_shift_rows: number
  /** He was there and is not on the plan. */
  unplanned_rows: number
  days: HoursDay[]
}

export interface HoursDay {
  business_date: string
  template_name: string | null
  start_time: string | null
  end_time: string | null
  status: AssignmentStatus | 'unplanned'
  planned_h: number
  first_action: string | null
  left_at: string | null
  left_auto: boolean
  worked_h: number
  late_min: number
  early_leave_min: number
  no_shift_row: boolean
}
