CREATE TABLE `shift_closings` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`client_id` text NOT NULL,
	`closed_by` text NOT NULL,
	`device_id` text,
	`prihod_fen` integer NOT NULL,
	`dnevnica_fen` integer NOT NULL,
	`otpis_fen` integer NOT NULL,
	`rashod_fen` integer NOT NULL,
	`roba_fen` integer NOT NULL,
	`okusi_fen` integer NOT NULL,
	`zar_fen` integer NOT NULL,
	`merkator_fen` integer NOT NULL,
	`za_predati_fen` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shift_closings_shift_uq` ON `shift_closings` (`venue_id`,`shift_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shift_closings_client_uq` ON `shift_closings` (`venue_id`,`client_id`);