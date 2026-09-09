-- Phase 3, and the only migration this phase adds (docs/PHASE3.md §1):
--   1. `staff_notes`         — *Napomena* on your own night (§1.6). Not a ledger
--                              table: no trigger, editable, deletable.
--   2. `tabs.table_id`       — nullable, for *Bez stola* (§1.11).
--   3. `products.system_key` — how a phone recognises *Dodatni žar* and
--                              *Ostalo* without matching on a name (§1.10).
--
-- Why item 2 rebuilds the table. SQLite can ADD a column and DROP a column, but
-- it cannot take NOT NULL *off* one — the only way is the documented dance
-- below: build the new shape beside the old, copy the rows, drop the old,
-- rename. Two consequences a reader should know about:
--
--   * `DROP TABLE tabs` takes the table's indexes AND its triggers with it. The
--     indexes are re-created at the bottom of this file. The triggers are not,
--     and do not need to be: `applyTriggers()` in `server/database/client.ts`
--     re-runs `triggers.sql` after every `migrate()`, at every boot, which is
--     exactly why the triggers live in their own file instead of in a migration.
--
--   * `orders`, `payments` and `line_adjustments` all point at `tabs`, so
--     between the DROP and the RENAME every one of their rows is briefly an
--     orphan. Foreign keys are therefore switched off *around* the migrator, in
--     `migrateWithForeignKeysOff()` in `server/database/client.ts`, which runs
--     `PRAGMA foreign_key_check` afterwards and refuses to boot if this file
--     orphaned anything. It cannot be done from inside this file: `PRAGMA
--     foreign_keys` is silently ignored inside a transaction and the migrator
--     wraps every file in one. The `defer_foreign_keys` line is belt and braces
--     for any other runner.

CREATE TABLE `staff_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_notes_shift_user_uq` ON `staff_notes` (`venue_id`,`shift_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `staff_notes_user_idx` ON `staff_notes` (`venue_id`,`user_id`,`shift_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`table_id` text,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`shift_id` text,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`assigned_to` text,
	`offered_to` text,
	`late_sync` integer DEFAULT 0 NOT NULL,
	`unpaid_reason` text,
	`unpaid_by` text,
	`unpaid_approved_by` text,
	`pending_review` integer DEFAULT 0 NOT NULL,
	`unpaid_client_id` text,
	`fiscal_status` text DEFAULT 'none' NOT NULL,
	`fiscal_ref` text,
	`closed_at` text,
	`closed_by` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offered_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tabs`("id", "venue_id", "table_id", "client_id", "status", "shift_id", "opened_by", "opened_at", "assigned_to", "offered_to", "late_sync", "unpaid_reason", "unpaid_by", "unpaid_approved_by", "pending_review", "unpaid_client_id", "fiscal_status", "fiscal_ref", "closed_at", "closed_by") SELECT "id", "venue_id", "table_id", "client_id", "status", "shift_id", "opened_by", "opened_at", "assigned_to", "offered_to", "late_sync", "unpaid_reason", "unpaid_by", "unpaid_approved_by", "pending_review", "unpaid_client_id", "fiscal_status", "fiscal_ref", "closed_at", "closed_by" FROM `tabs`;--> statement-breakpoint
DROP TABLE `tabs`;--> statement-breakpoint
ALTER TABLE `__new_tabs` RENAME TO `tabs`;--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_client_uq` ON `tabs` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_one_open_per_table_uq` ON `tabs` (`venue_id`,`table_id`) WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_unpaid_client_uq` ON `tabs` (`venue_id`,`unpaid_client_id`) WHERE unpaid_client_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tabs_venue_status_idx` ON `tabs` (`venue_id`,`status`);--> statement-breakpoint
CREATE INDEX `tabs_shift_idx` ON `tabs` (`venue_id`,`shift_id`,`status`);--> statement-breakpoint
CREATE INDEX `tabs_assigned_idx` ON `tabs` (`venue_id`,`assigned_to`,`status`);--> statement-breakpoint
ALTER TABLE `products` ADD `system_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `products_system_key_uq` ON `products` (`venue_id`,`system_key`) WHERE system_key IS NOT NULL;