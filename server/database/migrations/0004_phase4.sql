CREATE TABLE `chat_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`pinned_text` text,
	`pinned_by` text,
	`pinned_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_channels_kind_uq` ON `chat_channels` (`venue_id`,`kind`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`client_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`body` text,
	`upload_id` text,
	`reply_to_id` text,
	`forwarded_from_id` text,
	`author_id` text,
	`device_id` text,
	`system_key` text,
	`system_payload_json` text,
	`client_created_at` text,
	`client_created_at_adj` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`redacted_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`forwarded_from_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_client_uq` ON `chat_messages` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_seq_idx` ON `chat_messages` (`venue_id`,`seq`);--> statement-breakpoint
CREATE INDEX `chat_messages_channel_seq_idx` ON `chat_messages` (`venue_id`,`channel_id`,`seq`);--> statement-breakpoint
CREATE TABLE `chat_reads` (
	`venue_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`venue_id`, `channel_id`, `user_id`),
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `delivery_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`model` text NOT NULL,
	`raw_json` text,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`error` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`parsed_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_scans_status_idx` ON `delivery_scans` (`venue_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `roster_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`work_date` text NOT NULL,
	`template_id` text NOT NULL,
	`user_id` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`origin` text DEFAULT 'owner' NOT NULL,
	`swap_request_id` text,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_by` text,
	`updated_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_assignments_cell_uq` ON `roster_assignments` (`venue_id`,`work_date`,`template_id`,`user_id`) WHERE status NOT IN ('swapped','removed');--> statement-breakpoint
CREATE INDEX `roster_assignments_date_idx` ON `roster_assignments` (`venue_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `roster_assignments_user_idx` ON `roster_assignments` (`venue_id`,`user_id`,`work_date`);--> statement-breakpoint
CREATE TABLE `roster_weeks` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`week_start` text NOT NULL,
	`published_at` text,
	`published_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_weeks_start_uq` ON `roster_weeks` (`venue_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`version` integer NOT NULL,
	`body_md` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_version_uq` ON `rules` (`venue_id`,`version`);--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shift_templates_name_uq` ON `shift_templates` (`venue_id`,`name`);--> statement-breakpoint
CREATE TABLE `supplier_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`alias` text NOT NULL,
	`supplier_name` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_aliases_alias_uq` ON `supplier_aliases` (`venue_id`,`alias`);--> statement-breakpoint
CREATE TABLE `swap_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text,
	`reason` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `roster_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `swap_requests_live_uq` ON `swap_requests` (`venue_id`,`assignment_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `swap_requests_status_idx` ON `swap_requests` (`venue_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `swap_requests_from_idx` ON `swap_requests` (`venue_id`,`from_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`mime` text DEFAULT 'image/jpeg' NOT NULL,
	`created_by` text NOT NULL,
	`device_id` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uploads_kind_idx` ON `uploads` (`venue_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `uploads_creator_idx` ON `uploads` (`venue_id`,`created_by`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `rules_ack_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `rules_version` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `chat_muted_until` text;