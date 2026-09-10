-- 0005 — two roles, and a screen a session picks.
--
-- The owner collapsed the floor roles: `waiter` and `bartender` had identical
-- permissions and differed only in which screen they landed on, so the screen
-- stops being a property of the account and becomes a choice a worker makes
-- after the PIN. What is left is `admin` (Vlasnik) and `radnik` (Radnik).
--
-- `role` is a plain `text NOT NULL` in this schema — Drizzle's `enum` is a
-- TypeScript type and not a CHECK constraint, and 0000/0001 wrote no check
-- either — so there is no constraint to rebuild here: the values move and the
-- column stays as it is. That is also why this migration is three UPDATEs and
-- one ADD COLUMN instead of the twelve-statement table rebuild SQLite needs
-- when a check really does change.
ALTER TABLE `sessions` ADD `mode` text;--> statement-breakpoint

-- The accounts. Both floor roles become the one worker role.
UPDATE users SET role = 'radnik' WHERE role IN ('waiter', 'bartender');--> statement-breakpoint

-- The snapshot on every shift anybody has ever worked. It is a *snapshot* on
-- purpose (schema.ts) — remapping it keeps February's shifts readable by code
-- that now only knows two values, and loses nothing, because the distinction
-- the old value carried is exactly the one that stopped existing.
--
-- `shift_members` is append-only, and `shift_members_update_guard` permits
-- exactly one shape of UPDATE: `left_at`, once, NULL -> value. Rewriting `role`
-- is not that shape, so on any database that has already booted — the café's
-- own, and every test database built by a *second* run — this statement aborts
-- with "shift_members: only left_at, once, NULL -> value" and the server never
-- comes up. `0001_korak2.sql` hit the same wall with `tabs_update_guard` and
-- solved it the same way: drop the guard here, and let `applyTriggers()` put it
-- straight back, which it does after `migrate()` at every boot
-- (`server/database/client.ts`). A fresh `:memory:` database never notices
-- either way, which is exactly why this has to be reasoned about rather than
-- discovered from a green unit suite.
DROP TRIGGER IF EXISTS shift_members_update_guard;--> statement-breakpoint

UPDATE shift_members SET role = 'radnik' WHERE role IN ('waiter', 'bartender');--> statement-breakpoint

-- The owner's own settings. `approver_roles` and `payout_approver_roles` are
-- the two keys whose *values* are role names; `settings_json` holds only the
-- keys he has actually touched, so both updates are guarded on the key being
-- there at all. `DISTINCT` collapses the ['admin','waiter','bartender'] a
-- thorough owner may have saved into ['admin','radnik'].
UPDATE venues SET settings_json = json_replace(
  settings_json, '$.approver_roles',
  (SELECT json_group_array(DISTINCT CASE WHEN value IN ('waiter', 'bartender') THEN 'radnik' ELSE value END)
     FROM json_each(venues.settings_json, '$.approver_roles'))
) WHERE json_valid(settings_json) AND json_type(settings_json, '$.approver_roles') = 'array';--> statement-breakpoint

UPDATE venues SET settings_json = json_replace(
  settings_json, '$.payout_approver_roles',
  (SELECT json_group_array(DISTINCT CASE WHEN value IN ('waiter', 'bartender') THEN 'radnik' ELSE value END)
     FROM json_each(venues.settings_json, '$.payout_approver_roles'))
) WHERE json_valid(settings_json) AND json_type(settings_json, '$.payout_approver_roles') = 'array';
