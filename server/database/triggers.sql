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

-- ---------------------------------------------------------------------------
-- order_lines — append-only. What was charged is history.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- stock_movements — append-only. On hand is SUM(qty_delta); a ledger you can
-- edit is not a ledger. A mistake is corrected by a new 'correction' row.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- orders — one allowed transition: not prepared -> prepared, by somebody.
-- Every other column must be unchanged. `OLD.x IS NEW.x` and not `=`, because
-- in SQL `NULL = NULL` is NULL (neither true nor false) and `IS` is the
-- comparison that treats two NULLs as equal.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS orders_update_guard;
CREATE TRIGGER orders_update_guard
BEFORE UPDATE ON orders
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.tab_id IS NEW.tab_id
  AND OLD.client_id IS NEW.client_id
  AND OLD.locked_by IS NEW.locked_by
  AND OLD.note IS NEW.note
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

-- ---------------------------------------------------------------------------
-- tabs — one allowed transition: open -> paid, stamping who closed it and when.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tabs_update_guard;
CREATE TRIGGER tabs_update_guard
BEFORE UPDATE ON tabs
WHEN NOT (
  OLD.id IS NEW.id
  AND OLD.venue_id IS NEW.venue_id
  AND OLD.table_id IS NEW.table_id
  AND OLD.client_id IS NEW.client_id
  AND OLD.opened_by IS NEW.opened_by
  AND OLD.opened_at IS NEW.opened_at
  AND OLD.status = 'open' AND NEW.status = 'paid'
  AND OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL
  AND OLD.closed_by IS NULL AND NEW.closed_by IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'tabs: only open -> paid with closed_at/closed_by');
END;

DROP TRIGGER IF EXISTS tabs_no_delete;
CREATE TRIGGER tabs_no_delete
BEFORE DELETE ON tabs
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;
