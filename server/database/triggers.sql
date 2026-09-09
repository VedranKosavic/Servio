-- The ledger rules, enforced by the database itself.
--
-- A "trigger" is a small piece of SQL that SQLite runs automatically whenever a
-- row is inserted, updated or deleted. `RAISE(ABORT, '…')` cancels the statement
-- AND rolls back the transaction it is in, so a forbidden write can never land
-- even by accident, from a migration script, from a console, or from a bug in a
-- service that nobody has written yet.
--
-- These live in this .sql file rather than in the Drizzle schema because
-- drizzle-kit does not manage triggers: for many column changes it rebuilds a
-- table (copy into `__new_x`, drop, rename) and the triggers on the old table go
-- with it, silently. So `applyTriggers()` re-runs this whole file at every boot,
-- after the migrations. Every statement is written to be safe to run twice —
-- that is what "idempotent" means and why each CREATE has a DROP in front of it.
--
-- Two shapes repeat, and they are split on purpose (BACKEND §3.4):
--
--   `<t>_frozen_cols`   a short list of columns that may never change;
--   `<t>_status_guard`  the allowed transitions of the status column.
--
-- Keeping them apart means adding a mutable column is deleting a line, not
-- editing a twenty-clause boolean nobody can read at 03:10 in the morning.
--
-- `OLD.x IS NEW.x` and not `=`: in SQL `NULL = NULL` is NULL — neither true nor
-- false — and `IS` is the comparison that treats two NULLs as equal. Every
-- frozen-column check in this file uses `IS` for that reason.
--
-- Names are enumerated in `shared/constants.ts` as `TRIGGER_NAMES`, and
-- `tests/unit/schema.test.ts` asserts every one of them exists in `sqlite_master`.

-- ---------------------------------------------------------------------------
-- Retired in Korak 2. `tabs_update_guard` was Korak 1's single "open -> paid"
-- boolean; it is replaced below by `tabs_frozen_cols` + `tabs_status_guard`.
-- Dropping it here is what makes this file safe to run against a database that
-- has been through Korak 1 — otherwise the old rule would keep refusing the new
-- transitions and nothing would say why.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tabs_update_guard;

-- ---------------------------------------------------------------------------
-- Tables with NO triggers, deliberately, so nobody goes looking for the rule:
--
--   changes, sessions, enrol_codes  — cursors and credentials, not history.
--     `changes` is pruned weekly by a plain DELETE and `sessions` nightly; a
--     no-delete trigger that the prune then has to disable would weaken the
--     mechanism every other rule depends on. The ledgers they point at *are*
--     the history.
--   devices, task_runs, recipe_lines, and the catalogue tables (venues, users,
--   tables, categories, products, stock_items) — mutable configuration. A price
--     change is history in `price_history`; a renamed product is history in
--     `order_lines.name_snapshot`; both are ledgers with their own guards.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- ORDERS
-- ===========================================================================

-- order_lines — append-only. What was charged is history.
DROP TRIGGER IF EXISTS order_lines_no_update;
CREATE TRIGGER order_lines_no_update
BEFORE UPDATE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS order_lines_no_delete;
CREATE TRIGGER order_lines_no_delete
BEFORE DELETE ON order_lines
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- orders — one allowed transition: not prepared -> prepared, by somebody.
-- Every other column, including all nine Korak 2 additions, must be unchanged.
DROP TRIGGER IF EXISTS orders_update_guard;
CREATE TRIGGER orders_update_guard
BEFORE UPDATE ON orders
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.tab_id IS NEW.tab_id
  AND OLD.client_id IS NEW.client_id
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.shift_seq IS NEW.shift_seq
  AND OLD.locked_by IS NEW.locked_by
  AND OLD.device_id IS NEW.device_id
  AND OLD.note IS NEW.note
  AND OLD.client_created_at IS NEW.client_created_at
  AND OLD.client_created_at_adj IS NEW.client_created_at_adj
  AND OLD.sync_lag_s IS NEW.sync_lag_s
  AND OLD.late_sync IS NEW.late_sync
  AND OLD.post_settle IS NEW.post_settle
  AND OLD.source IS NEW.source
  AND OLD.created_at IS NEW.created_at
  AND OLD.prepared_at IS NULL AND NEW.prepared_at IS NOT NULL
  AND OLD.prepared_by IS NULL AND NEW.prepared_by IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'orders: only prepared_at/prepared_by, once, NULL -> value');
END;

DROP TRIGGER IF EXISTS orders_no_delete;
CREATE TRIGGER orders_no_delete
BEFORE DELETE ON orders
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- How a column that cannot be declared NOT NULL becomes NOT NULL anyway.
-- `orders.shift_id` REFERENCES shifts(id), and SQLite refuses to ADD a
-- REFERENCES column with a non-NULL default (BACKEND §2, migration rule 1). So
-- the column is nullable in the DDL and mandatory here, on the one path that
-- can create a row.
DROP TRIGGER IF EXISTS orders_shift_required;
CREATE TRIGGER orders_shift_required
BEFORE INSERT ON orders
WHEN NEW.shift_id IS NULL OR NEW.shift_seq IS NULL
BEGIN
  SELECT RAISE(ABORT, 'orders: shift_id and shift_seq required');
END;

-- ===========================================================================
-- TABS
-- ===========================================================================

DROP TRIGGER IF EXISTS tabs_no_delete;
CREATE TRIGGER tabs_no_delete
BEFORE DELETE ON tabs
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- Same reason as `orders_shift_required`: `assigned_to` REFERENCES users(id),
-- so it is nullable in DDL, backfilled by the migration, and mandatory here.
-- This is why no reader needs a `tabAssignee()` fallback — there is no row that
-- could reach one.
DROP TRIGGER IF EXISTS tabs_assigned_required;
CREATE TRIGGER tabs_assigned_required
BEFORE INSERT ON tabs
WHEN NEW.assigned_to IS NULL
BEGIN
  SELECT RAISE(ABORT, 'tabs: assigned_to required');
END;

DROP TRIGGER IF EXISTS tabs_frozen_cols;
CREATE TRIGGER tabs_frozen_cols
BEFORE UPDATE ON tabs
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.client_id IS NEW.client_id
  AND OLD.opened_by IS NEW.opened_by
  AND OLD.opened_at IS NEW.opened_at
  AND OLD.shift_id IS NEW.shift_id
)
BEGIN
  SELECT RAISE(ABORT, 'tabs: frozen column changed');
END;

-- The four legal shapes of a tab's life. Note what is missing: no branch has
-- `OLD.status = 'paid' AND NEW.status <> 'paid'`. A paid tab never reopens.
DROP TRIGGER IF EXISTS tabs_status_guard;
CREATE TRIGGER tabs_status_guard
BEFORE UPDATE ON tabs
WHEN NOT (
  -- still open: moved to another table, reassigned, offered, review flipped.
  (OLD.status = 'open' AND NEW.status = 'open' AND NEW.closed_at IS NULL)

  -- closing it: paid, written off unpaid, or (Korak 3) voided. Stamp who, when.
  OR (OLD.status = 'open' AND NEW.status IN ('paid', 'unpaid', 'voided')
      AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
      AND OLD.closed_by IS NULL AND NEW.closed_by IS NOT NULL)

  -- collected later. The original close stands exactly as it was written.
  OR (OLD.status = 'unpaid' AND NEW.status = 'paid'
      AND OLD.table_id IS NEW.table_id
      AND OLD.closed_at IS NEW.closed_at
      AND OLD.closed_by IS NEW.closed_by
      AND OLD.unpaid_by IS NEW.unpaid_by
      AND OLD.unpaid_reason IS NEW.unpaid_reason)

  -- a closed tab, status unchanged: only the review flag, the approver of an
  -- unpaid write-off and the reserved fiscal columns may still move.
  OR (OLD.status <> 'open' AND NEW.status IS OLD.status
      AND OLD.table_id IS NEW.table_id
      AND OLD.closed_at IS NEW.closed_at
      AND OLD.closed_by IS NEW.closed_by
      AND OLD.assigned_to IS NEW.assigned_to
      AND OLD.offered_to IS NEW.offered_to
      AND OLD.unpaid_by IS NEW.unpaid_by
      AND OLD.unpaid_reason IS NEW.unpaid_reason
      AND OLD.unpaid_client_id IS NEW.unpaid_client_id
      AND OLD.late_sync IS NEW.late_sync)
)
BEGIN
  SELECT RAISE(ABORT, 'tabs: illegal transition');
END;

-- ===========================================================================
-- PAYMENTS
-- ===========================================================================

-- Append-only. A refund is a **negative row** with an approver, never an edit of
-- the original — so `SUM(amount_fen)` is what was taken and always was.
DROP TRIGGER IF EXISTS payments_no_update;
CREATE TRIGGER payments_no_update
BEFORE UPDATE ON payments
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS payments_no_delete;
CREATE TRIGGER payments_no_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS payments_shift_required;
CREATE TRIGGER payments_shift_required
BEFORE INSERT ON payments
WHEN NEW.shift_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'payments: shift_id required');
END;

-- Money going back to a guest is somebody's decision, and the row says whose.
DROP TRIGGER IF EXISTS payments_reversal_needs_approver;
CREATE TRIGGER payments_reversal_needs_approver
BEFORE INSERT ON payments
WHEN NEW.amount_fen < 0 AND NEW.approved_by IS NULL
BEGIN
  SELECT RAISE(ABORT, 'payments: a reversal needs approved_by');
END;

-- ===========================================================================
-- LINE ADJUSTMENTS (voids and comps) — one transition
-- ===========================================================================

-- `pending -> applied|rejected`, once, with a decider and a time. The amount,
-- the line and the requester are frozen: a void whose amount can be edited
-- while it is being approved is not an approval of anything.
DROP TRIGGER IF EXISTS line_adjustments_update_guard;
CREATE TRIGGER line_adjustments_update_guard
BEFORE UPDATE ON line_adjustments
WHEN NOT (
  OLD.status = 'pending' AND NEW.status IN ('applied', 'rejected')
  AND NEW.decided_at IS NOT NULL
  AND NEW.approved_by IS NOT NULL
  AND OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.order_line_id IS NEW.order_line_id
  AND OLD.tab_id IS NEW.tab_id
  AND OLD.client_id IS NEW.client_id
  AND OLD.kind IS NEW.kind
  AND OLD.reason IS NEW.reason
  AND OLD.note IS NEW.note
  AND OLD.qty IS NEW.qty
  AND OLD.amount_fen IS NEW.amount_fen
  AND OLD.requested_by IS NEW.requested_by
  AND OLD.device_id IS NEW.device_id
  AND OLD.seconds_since_lock IS NEW.seconds_since_lock
  AND OLD.was_paid IS NEW.was_paid
  AND OLD.auto IS NEW.auto
  AND OLD.created_at IS NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'line_adjustments: only pending -> applied|rejected, once');
END;

DROP TRIGGER IF EXISTS line_adjustments_no_delete;
CREATE TRIGGER line_adjustments_no_delete
BEFORE DELETE ON line_adjustments
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- ===========================================================================
-- SHIFTS
-- ===========================================================================

DROP TRIGGER IF EXISTS shifts_frozen_cols;
CREATE TRIGGER shifts_frozen_cols
BEFORE UPDATE ON shifts
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.business_date IS NEW.business_date
  AND OLD.opened_at IS NEW.opened_at
  AND OLD.opened_by IS NEW.opened_by
  AND OLD.auto_opened IS NEW.auto_opened
  AND OLD.created_at IS NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'shifts: frozen column changed');
END;

-- A closed shift can never go back to open. That is the whole point of the
-- table: the night is over and its numbers are a record, not a draft.
DROP TRIGGER IF EXISTS shifts_status_guard;
CREATE TRIGGER shifts_status_guard
BEFORE UPDATE ON shifts
WHEN NOT (
  (OLD.status = 'open' AND NEW.status IN ('open', 'closing', 'closed'))

  -- `closing` may go back to `open`: the settlements are in, somebody locks one
  -- more round, and the shift is working again.
  OR (OLD.status = 'closing' AND NEW.status IN ('open', 'closing', 'closed'))

  OR (OLD.status = 'closed' AND NEW.status = 'closed')

  -- the review: stamps who and when, and may correct the card total and the note.
  OR (OLD.status = 'closed' AND NEW.status = 'reviewed'
      AND OLD.reviewed_by IS NULL AND NEW.reviewed_by IS NOT NULL
      AND OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NOT NULL)

  -- after the review, only the note.
  OR (OLD.status = 'reviewed' AND NEW.status = 'reviewed'
      AND OLD.closed_at IS NEW.closed_at
      AND OLD.closed_by IS NEW.closed_by
      AND OLD.closed_kind IS NEW.closed_kind
      AND OLD.cash_counted_fen IS NEW.cash_counted_fen
      AND OLD.card_total_fen IS NEW.card_total_fen
      AND OLD.reviewed_by IS NEW.reviewed_by
      AND OLD.reviewed_at IS NEW.reviewed_at)
)
BEGIN
  SELECT RAISE(ABORT, 'shifts: illegal transition');
END;

DROP TRIGGER IF EXISTS shifts_no_delete;
CREATE TRIGGER shifts_no_delete
BEFORE DELETE ON shifts
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- Leaving a shift happens once. A logout is not a leave (BACKEND §5.1): on the
-- shared bar tablet *Promijeni korisnika* happens a dozen times a night, and
-- ending Emir's row at 21:40 could never be undone.
DROP TRIGGER IF EXISTS shift_members_update_guard;
CREATE TRIGGER shift_members_update_guard
BEFORE UPDATE ON shift_members
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.user_id IS NEW.user_id
  AND OLD.role IS NEW.role
  AND OLD.joined_at IS NEW.joined_at
  AND OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'shift_members: only left_at, once, NULL -> value');
END;

DROP TRIGGER IF EXISTS shift_members_no_delete;
CREATE TRIGGER shift_members_no_delete
BEFORE DELETE ON shift_members
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- ===========================================================================
-- CASH
-- ===========================================================================

DROP TRIGGER IF EXISTS cash_movements_update_guard;
CREATE TRIGGER cash_movements_update_guard
BEFORE UPDATE ON cash_movements
WHEN NOT (
  OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')
  AND OLD.decided_by IS NULL AND NEW.decided_by IS NOT NULL
  AND OLD.decided_at IS NULL AND NEW.decided_at IS NOT NULL
  AND OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.type IS NEW.type
  AND OLD.amount_fen IS NEW.amount_fen
  AND OLD.user_id IS NEW.user_id
  AND OLD.created_by IS NEW.created_by
  AND OLD.created_at IS NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'cash_movements: only pending -> approved|rejected, once');
END;

DROP TRIGGER IF EXISTS cash_movements_no_delete;
CREATE TRIGGER cash_movements_no_delete
BEFORE DELETE ON cash_movements
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- The blind declaration is written once and accepted once. Nothing about what
-- the waiter declared may move afterwards — that is what makes it blind.
DROP TRIGGER IF EXISTS waiter_settlements_update_guard;
CREATE TRIGGER waiter_settlements_update_guard
BEFORE UPDATE ON waiter_settlements
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.user_id IS NEW.user_id
  AND OLD.declared_fen IS NEW.declared_fen
  AND OLD.expected_at_declare_fen IS NEW.expected_at_declare_fen
  AND OLD.breakdown_json IS NEW.breakdown_json
  AND OLD.summary_json IS NEW.summary_json
  AND OLD.self_sealed IS NEW.self_sealed
  AND OLD.unsent_reported_json IS NEW.unsent_reported_json
  AND OLD.device_id IS NEW.device_id
  AND OLD.late IS NEW.late
  AND OLD.created_at IS NEW.created_at
  AND OLD.accepted_by IS NULL AND NEW.accepted_by IS NOT NULL
  AND OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'waiter_settlements: only accepted_by/accepted_at, once');
END;

DROP TRIGGER IF EXISTS waiter_settlements_no_delete;
CREATE TRIGGER waiter_settlements_no_delete
BEFORE DELETE ON waiter_settlements
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- Versioned, never rewritten: "what did the summary say when we closed?" has to
-- stay answerable after every later decision moves the live number.
DROP TRIGGER IF EXISTS shift_summaries_no_update;
CREATE TRIGGER shift_summaries_no_update
BEFORE UPDATE ON shift_summaries
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS shift_summaries_no_delete;
CREATE TRIGGER shift_summaries_no_delete
BEFORE DELETE ON shift_summaries
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- ===========================================================================
-- STOCK
-- ===========================================================================

-- stock_movements — append-only. On hand is SUM(qty_delta); a ledger you can
-- edit is not a ledger. A mistake is corrected by a new 'correction' row.
DROP TRIGGER IF EXISTS stock_movements_no_update;
CREATE TRIGGER stock_movements_no_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS stock_movements_no_delete;
CREATE TRIGGER stock_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- Two transitions, each allowed exactly once, and nothing else.
--
-- The confirm (`submitted -> confirmed`) is the owner's signature, and it is the
-- one that moves the ledger. The witness (PHASE3 §1.4) is the incoming
-- custodian's *Potvrđujem stanje*: it fills `witnessed_by` / `witnessed_at`,
-- leaves `status` where it was, and changes no quantity anywhere — which is why
-- widening the guard for it takes nothing away. Everything the count *is*
-- (its lines' quantities, who counted, when) still cannot be rewritten, and
-- `NULL -> value, once` still holds for both pairs of columns.
DROP TRIGGER IF EXISTS stock_counts_update_guard;
CREATE TRIGGER stock_counts_update_guard
BEFORE UPDATE ON stock_counts
WHEN NOT (
  -- The identity of the count never moves, whichever transition this is.
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.kind IS NEW.kind
  AND OLD.phase IS NEW.phase
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.counted_by IS NEW.counted_by
  AND OLD.submitted_at IS NEW.submitted_at
  AND (
    -- 1. The confirm.
    (
      OLD.status = 'submitted' AND NEW.status = 'confirmed'
      AND OLD.confirmed_by IS NULL AND NEW.confirmed_by IS NOT NULL
      AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
      AND OLD.witnessed_by IS NEW.witnessed_by
      AND OLD.witnessed_at IS NEW.witnessed_at
    )
    -- 2. The witness.
    OR (
      OLD.status IS NEW.status
      AND OLD.confirmed_by IS NEW.confirmed_by
      AND OLD.confirmed_at IS NEW.confirmed_at
      AND OLD.override_by IS NEW.override_by
      AND OLD.note IS NEW.note
      AND OLD.witnessed_by IS NULL AND NEW.witnessed_by IS NOT NULL
      AND OLD.witnessed_at IS NULL AND NEW.witnessed_at IS NOT NULL
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'stock_counts: only submitted -> confirmed or a first witness, once');
END;

DROP TRIGGER IF EXISTS stock_counts_no_delete;
CREATE TRIGGER stock_counts_no_delete
BEFORE DELETE ON stock_counts
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- What was counted is what was counted. `applied_adjust` is the single column
-- the confirm fills in, and only once.
DROP TRIGGER IF EXISTS stock_count_lines_update_guard;
CREATE TRIGGER stock_count_lines_update_guard
BEFORE UPDATE ON stock_count_lines
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.count_id IS NEW.count_id
  AND OLD.stock_item_id IS NEW.stock_item_id
  AND OLD.counted_packs IS NEW.counted_packs
  AND OLD.counted_loose IS NEW.counted_loose
  AND OLD.weighed_g IS NEW.weighed_g
  AND OLD.counted_qty IS NEW.counted_qty
  AND OLD.theoretical_qty IS NEW.theoretical_qty
  AND OLD.variance_qty IS NEW.variance_qty
  AND OLD.unit_cost_mfen IS NEW.unit_cost_mfen
  AND OLD.variance_fen IS NEW.variance_fen
  AND OLD.note IS NEW.note
  AND OLD.applied_adjust IS NULL AND NEW.applied_adjust IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'stock_count_lines: only applied_adjust, once, NULL -> value');
END;

DROP TRIGGER IF EXISTS stock_count_lines_no_delete;
CREATE TRIGGER stock_count_lines_no_delete
BEFORE DELETE ON stock_count_lines
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- A posted delivery may be reversed exactly once, and may not be edited at all:
-- the invoice it records did not change.
DROP TRIGGER IF EXISTS deliveries_update_guard;
CREATE TRIGGER deliveries_update_guard
BEFORE UPDATE ON deliveries
WHEN NOT (
  -- the Korak 3 scan flow's draft, posted.
  (OLD.status = 'draft' AND NEW.status = 'posted'
   AND NEW.posted_by IS NOT NULL AND NEW.posted_at IS NOT NULL)

  -- the one reversal.
  OR (OLD.status = 'posted' AND NEW.status = 'posted'
      AND OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL
      AND OLD.reversed_by IS NULL AND NEW.reversed_by IS NOT NULL
      AND OLD.id IS NEW.id
      AND OLD.venue_id IS NEW.venue_id
      AND OLD.client_id IS NEW.client_id
      AND OLD.supplier_name IS NEW.supplier_name
      AND OLD.invoice_no IS NEW.invoice_no
      AND OLD.delivered_at IS NEW.delivered_at
      AND OLD.total_fen IS NEW.total_fen
      AND OLD.entered_by IS NEW.entered_by
      AND OLD.created_at IS NEW.created_at)
)
BEGIN
  SELECT RAISE(ABORT, 'deliveries: only draft -> posted, or one reversal');
END;

DROP TRIGGER IF EXISTS deliveries_no_delete;
CREATE TRIGGER deliveries_no_delete
BEFORE DELETE ON deliveries
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- Plain append-only, rather than a cross-table sub-select on the header: simpler
-- to read, impossible to get wrong, and a reversal writes `correction` movements
-- instead of touching these rows.
DROP TRIGGER IF EXISTS delivery_lines_no_update;
CREATE TRIGGER delivery_lines_no_update
BEFORE UPDATE ON delivery_lines
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS delivery_lines_no_delete;
CREATE TRIGGER delivery_lines_no_delete
BEFORE DELETE ON delivery_lines
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- The bottle is broken whether or not anyone approves. The write always lands;
-- only the approval moves afterwards.
DROP TRIGGER IF EXISTS waste_events_update_guard;
CREATE TRIGGER waste_events_update_guard
BEFORE UPDATE ON waste_events
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.stock_item_id IS NEW.stock_item_id
  AND OLD.client_id IS NEW.client_id
  AND OLD.qty IS NEW.qty
  AND OLD.reason IS NEW.reason
  AND OLD.note IS NEW.note
  AND OLD.cost_fen IS NEW.cost_fen
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.user_id IS NEW.user_id
  AND OLD.needs_approval IS NEW.needs_approval
  AND OLD.created_at IS NEW.created_at
  AND OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL
  AND OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'waste_events: only approved_by/approved_at, once');
END;

DROP TRIGGER IF EXISTS waste_events_no_delete;
CREATE TRIGGER waste_events_no_delete
BEFORE DELETE ON waste_events
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- ===========================================================================
-- LOG, ALERTS, PRICES, AUTH
-- ===========================================================================

DROP TRIGGER IF EXISTS log_entries_no_delete;
CREATE TRIGGER log_entries_no_delete
BEFORE DELETE ON log_entries
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- The only edit a Dnevnik entry accepts is a redaction, and a redaction says so
-- in the row. Rewriting a title without stamping `redacted_at` is exactly the
-- edit this table exists to prevent.
DROP TRIGGER IF EXISTS log_entries_update_guard;
CREATE TRIGGER log_entries_update_guard
BEFORE UPDATE ON log_entries
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.kind IS NEW.kind
  AND OLD.ref_type IS NEW.ref_type
  AND OLD.ref_id IS NEW.ref_id
  AND OLD.actor_id IS NEW.actor_id
  AND OLD.device_id IS NEW.device_id
  AND OLD.shift_id IS NEW.shift_id
  AND OLD.business_date IS NEW.business_date
  AND OLD.resolves_id IS NEW.resolves_id
  AND OLD.created_at IS NEW.created_at
  AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'log_entries: only a redaction');
END;

-- The dedupe key and the payload are frozen; the delivery bookkeeping is not.
DROP TRIGGER IF EXISTS alert_events_update_guard;
CREATE TRIGGER alert_events_update_guard
BEFORE UPDATE ON alert_events
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.rule_key IS NEW.rule_key
  AND OLD.ref_type IS NEW.ref_type
  AND OLD.ref_id IS NEW.ref_id
  AND OLD.payload_json IS NEW.payload_json
  AND OLD.created_at IS NEW.created_at
  AND (OLD.sent_at IS NEW.sent_at OR OLD.sent_at IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'alert_events: only sent_at/attempts/last_error/send_after');
END;

DROP TRIGGER IF EXISTS alert_events_no_delete;
CREATE TRIGGER alert_events_no_delete
BEFORE DELETE ON alert_events
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- A price row is closed, never re-priced: the new price is a new row.
DROP TRIGGER IF EXISTS price_history_update_guard;
CREATE TRIGGER price_history_update_guard
BEFORE UPDATE ON price_history
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.product_id IS NEW.product_id
  AND OLD.price_fen IS NEW.price_fen
  AND OLD.valid_from IS NEW.valid_from
  AND OLD.changed_by IS NEW.changed_by
  AND OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'price_history: only valid_to, once, NULL -> value');
END;

DROP TRIGGER IF EXISTS price_history_no_delete;
CREATE TRIGGER price_history_no_delete
BEFORE DELETE ON price_history
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

-- The lockout evidence. If these rows could be edited or removed, the lockout
-- would count nothing and a 4-digit PIN would fall in an afternoon.
DROP TRIGGER IF EXISTS auth_attempts_no_update;
CREATE TRIGGER auth_attempts_no_update
BEFORE UPDATE ON auth_attempts
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;

DROP TRIGGER IF EXISTS auth_attempts_no_delete;
CREATE TRIGGER auth_attempts_no_delete
BEFORE DELETE ON auth_attempts
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;
