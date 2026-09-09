CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `categories_venue_idx` ON `categories` (`venue_id`,`sort`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`qty` real NOT NULL,
	`unit_price_fen` integer NOT NULL,
	`charged_fen` integer NOT NULL,
	`flavours_json` text,
	`note` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_idx` ON `order_lines` (`venue_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`tab_id` text NOT NULL,
	`client_id` text NOT NULL,
	`locked_by` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`prepared_at` text,
	`prepared_by` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`locked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prepared_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_client_uq` ON `orders` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `orders_tab_idx` ON `orders` (`venue_id`,`tab_id`);--> statement-breakpoint
CREATE INDEX `orders_prep_idx` ON `orders` (`venue_id`,`prepared_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`price_fen` integer NOT NULL,
	`kind` text DEFAULT 'simple' NOT NULL,
	`sells_stock_item_id` text,
	`shisha_grams` real,
	`coal_pcs` integer,
	`is_favourite` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sells_stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_venue_cat_idx` ON `products` (`venue_id`,`category_id`,`sort`);--> statement-breakpoint
CREATE TABLE `recipe_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`product_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`qty` real NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipe_lines_product_idx` ON `recipe_lines` (`venue_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `stock_items` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`base_unit` text NOT NULL,
	`pack_name` text,
	`pack_qty` real,
	`is_spot` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_items_venue_idx` ON `stock_items` (`venue_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`type` text NOT NULL,
	`qty_delta` real NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`user_id` text,
	`note` text,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_item_idx` ON `stock_movements` (`venue_id`,`stock_item_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `stock_movements_ref_idx` ON `stock_movements` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `tables` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`name` text NOT NULL,
	`zone` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`grp` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tables_venue_zone_idx` ON `tables` (`venue_id`,`zone`,`sort`);--> statement-breakpoint
CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`table_id` text NOT NULL,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`closed_by` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_client_uq` ON `tabs` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_one_open_per_table_uq` ON `tabs` (`venue_id`,`table_id`) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX `tabs_venue_status_idx` ON `tabs` (`venue_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `users_venue_idx` ON `users` (`venue_id`);--> statement-breakpoint
CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `venues_slug_uq` ON `venues` (`slug`);