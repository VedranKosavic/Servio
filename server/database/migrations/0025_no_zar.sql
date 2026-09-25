-- *Dodatni žar* is gone (the owner, 25.09.2026: "we will never need it").
--
-- The product was a 0 KM line that took two pieces of coal off the shelf and
-- hung off a bowl through `order_lines.parent_line_id`. Nothing on any screen
-- adds it any more, so the row is switched off rather than deleted: the lines
-- locked before today still name it, and `order_lines` is a ledger.
--
-- Its `system_key` is cleared as well, which is what lets the code forget the
-- value `'zar'` altogether. The partial unique index on `system_key` only looks
-- at rows where it is NOT NULL, so clearing it can collide with nothing.
--
-- The `changes` row is the same bump *Meni* writes when the owner edits an
-- article: it moves `menu_version`, so every phone refetches `/api/bootstrap`
-- on its next poll and the *Žar* tile leaves the menu without a restart.
INSERT INTO `changes` (`venue_id`, `entity`, `entity_id`, `created_at`)
SELECT `venue_id`, 'menu', `id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `products` WHERE `system_key` = 'zar';
--> statement-breakpoint
UPDATE `products`
SET `active` = 0, `system_key` = NULL, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `system_key` = 'zar';
