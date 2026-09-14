-- 0007 — a tab holds its table until somebody clears it.
--
-- Taking the money and freeing the table used to be one act. In a shisha
-- lounge they are two: a bowl is an hour and a half, the bill is often settled
-- long before the guests stand up, and a shift walking in has to tell an empty
-- table from one that was paid and not yet wiped down. `cleared_at`, not
-- `status`, is what the floor plan reads from now on.
--
-- Everything already here is history, so every tab that is not open is cleared
-- as of the moment it closed — without that the partial index below would see
-- every paid tab a table ever had as still holding it.
ALTER TABLE `tabs` ADD `cleared_at` text;--> statement-breakpoint
ALTER TABLE `tabs` ADD `cleared_by` text REFERENCES users(id);--> statement-breakpoint
UPDATE `tabs` SET `cleared_at` = COALESCE(`closed_at`, `opened_at`) WHERE `status` <> 'open';--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_one_live_per_table_uq` ON `tabs` (`venue_id`,`table_id`) WHERE cleared_at IS NULL AND status IN ('open', 'paid');