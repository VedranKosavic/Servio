/**
 * Tabs, rounds, payments and the prep tickets.
 *
 * WP3 owns this fragment (`docs/BACKEND.md` §6.1–§6.4). WP0 seeds it with the
 * Korak 1 shapes plus the widened `TabStatus`, so the frozen waiter screens keep
 * compiling until WP9 rewires them.
 */
export type TabStatus = 'open' | 'paid' | 'unpaid' | 'voided'
export type PaymentMethod = 'cash' | 'card'
export type AdjustmentKind = 'void' | 'comp'
export type RefundKind = 'none' | 'from_waiter' | 'from_drawer'

export interface TableState {
  table_id: string
  tab_id: string | null
  total_fen: number
  opened_by_name: string | null
  opened_at: string | null
  last_order_at: string | null
}

export interface CreateOrderResult {
  order_id: string
  tab_id: string
  order_total_fen: number
  tab_total_fen: number
  /** True when this request was a replay of one already applied. */
  already_applied: boolean
}

export interface Tab {
  id: string
  table_id: string
  table_name: string
  client_id: string
  status: TabStatus
  total_fen: number
  opened_by: string
  opened_at: string
  closed_at: string | null
  closed_by: string | null
}

export interface PrepLine {
  name_snapshot: string
  qty: number
  flavours: string[]
  note: string | null
}

export interface PrepOrder {
  order_id: string
  table_name: string
  waiter_name: string
  created_at: string
  prepared_at: string | null
  prepared_by_name: string | null
  note: string | null
  lines: PrepLine[]
}

export interface Prep {
  open: PrepOrder[]
  done: PrepOrder[]
}
