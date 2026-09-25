-- Working without internet, the server's half (docs/OFFLINE.md §4.2, §4.4).
--
-- 1. `tabs_one_open_per_table_uq` goes. It was the older, stricter twin of
--    `tabs_one_live_per_table_uq` (one uncleared open-or-paid tab per table),
--    and it was the one thing forcing the next guests' round onto a tab that
--    had been given back while it still owed money: an `open` tab that is off
--    the table. The live index stays and is the rule the floor plan reads.
-- 2. `cleared_client_id` is the phone's key for an *Očisti sto* that came
--    through the outbox (`POST /api/tabs/clear`). Unique per venue, partial like
--    `unpaid_client_id`, so a replay finds its own clear and a hundred tabs
--    cleared online, with no key, collide on nothing.
DROP INDEX `tabs_one_open_per_table_uq`;--> statement-breakpoint
ALTER TABLE `tabs` ADD `cleared_client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_cleared_client_uq` ON `tabs` (`venue_id`,`cleared_client_id`) WHERE cleared_client_id IS NOT NULL;