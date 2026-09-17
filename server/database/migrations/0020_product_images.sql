CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`product_id` text NOT NULL,
	`bytes` blob NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_images_product_uq` ON `product_images` (`venue_id`,`product_id`);--> statement-breakpoint
ALTER TABLE `products` ADD `image_version` text;