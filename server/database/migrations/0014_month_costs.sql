CREATE TABLE `month_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_costs_uq` ON `month_costs` (`venue_id`,`month`,`kind`);