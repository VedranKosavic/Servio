-- 0008 — otpis picks a menu article and is valued at its menu price.
--
-- The owner's call: "we don't use the purchase cost, we use the normal price of
-- the articles from the menu." `waste_events.stock_item_id` is NOT NULL and a
-- product with no stock link has no stock item to name; relaxing that is a
-- table rebuild, which this repo never does. So the new otpis gets a table of
-- its own and `waste_events` stays as readable history.
--
-- drizzle-kit also re-emitted 0007's `tabs.cleared_at` statements here, because
-- 0007 was committed without a snapshot. They are removed: 0007 already ran
-- them, and running them twice fails.
CREATE TABLE `product_waste` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`client_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty` real NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`unit_price_fen` integer NOT NULL,
	`value_fen` integer NOT NULL,
	`flavours_json` text,
	`shift_id` text,
	`user_id` text NOT NULL,
	`needs_approval` integer DEFAULT 0 NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_waste_client_uq` ON `product_waste` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `product_waste_shift_idx` ON `product_waste` (`venue_id`,`shift_id`);--> statement-breakpoint
CREATE INDEX `product_waste_created_idx` ON `product_waste` (`venue_id`,`created_at`);
