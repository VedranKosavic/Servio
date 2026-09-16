CREATE TABLE `month_extra_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`client_id` text NOT NULL,
	`month` text NOT NULL,
	`label` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_extra_costs_client_uq` ON `month_extra_costs` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `month_extra_costs_month_idx` ON `month_extra_costs` (`venue_id`,`month`);