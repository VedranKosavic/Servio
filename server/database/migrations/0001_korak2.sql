CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`send_after` text NOT NULL,
	`sent_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_events_dedupe_uq` ON `alert_events` (`venue_id`,`rule_key`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE INDEX `alert_events_unsent_idx` ON `alert_events` (`venue_id`,`sent_at`,`send_after`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`device_id` text,
	`user_id` text,
	`ip` text NOT NULL,
	`kind` text NOT NULL,
	`ok` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_subject_idx` ON `auth_attempts` (`venue_id`,`device_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`reason` text,
	`note` text,
	`status` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`ref_type` text,
	`ref_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_movements_shift_idx` ON `cash_movements` (`venue_id`,`shift_id`,`type`,`status`);--> statement-breakpoint
CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `changes_venue_seq_idx` ON `changes` (`venue_id`,`seq`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`client_id` text NOT NULL,
	`supplier_name` text NOT NULL,
	`invoice_no` text,
	`delivered_at` text NOT NULL,
	`total_fen` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`scan_id` text,
	`note` text,
	`entered_by` text NOT NULL,
	`posted_by` text,
	`posted_at` text,
	`reversed_at` text,
	`reversed_by` text,
	`reversal_note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_client_uq` ON `deliveries` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `deliveries_delivered_idx` ON `deliveries` (`venue_id`,`delivered_at`);--> statement-breakpoint
CREATE INDEX `deliveries_status_idx` ON `deliveries` (`venue_id`,`status`);--> statement-breakpoint
CREATE TABLE `delivery_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`pack_qty_used` real,
	`packs` real DEFAULT 0 NOT NULL,
	`loose` real DEFAULT 0 NOT NULL,
	`qty` real NOT NULL,
	`line_cost_fen` integer NOT NULL,
	`unit_cost_mfen` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `delivery_lines_delivery_idx` ON `delivery_lines` (`venue_id`,`delivery_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`mode` text NOT NULL,
	`bound_user_id` text,
	`enrolled_at` text NOT NULL,
	`enrolled_by` text,
	`revoked_at` text,
	`revoked_by` text,
	`locked_at` text,
	`last_seen_at` text,
	`app_version` text,
	`standalone` integer,
	`pending_count` integer DEFAULT 0 NOT NULL,
	`oldest_pending_at` text,
	`clock_skew_s` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bound_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_uq` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `devices_venue_idx` ON `devices` (`venue_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `devices_bound_idx` ON `devices` (`venue_id`,`bound_user_id`);--> statement-breakpoint
CREATE TABLE `enrol_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`code` text NOT NULL,
	`mode` text NOT NULL,
	`bound_user_id` text,
	`label` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`uses_left` integer DEFAULT 2 NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrol_codes_code_uq` ON `enrol_codes` (`code`);--> statement-breakpoint
CREATE INDEX `enrol_codes_venue_idx` ON `enrol_codes` (`venue_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `line_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`tab_id` text NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`qty` real NOT NULL,
	`amount_fen` integer NOT NULL,
	`restock` integer NOT NULL,
	`requested_by` text NOT NULL,
	`device_id` text,
	`seconds_since_lock` integer NOT NULL,
	`was_paid` integer NOT NULL,
	`status` text NOT NULL,
	`auto` integer DEFAULT 0 NOT NULL,
	`approved_by` text,
	`decided_on_device_id` text,
	`foreign_device` integer DEFAULT 0 NOT NULL,
	`decided_at` text,
	`decided_in_shift_id` text,
	`refund_kind` text DEFAULT 'none' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `line_adjustments_client_uq` ON `line_adjustments` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `line_adjustments_line_uq` ON `line_adjustments` (`venue_id`,`order_line_id`) WHERE status IN ('pending','applied');--> statement-breakpoint
CREATE INDEX `line_adjustments_tab_idx` ON `line_adjustments` (`venue_id`,`tab_id`,`status`);--> statement-breakpoint
CREATE INDEX `line_adjustments_requester_idx` ON `line_adjustments` (`venue_id`,`requested_by`,`created_at`);--> statement-breakpoint
CREATE INDEX `line_adjustments_pending_idx` ON `line_adjustments` (`venue_id`,`created_at`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `log_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`kind` text NOT NULL,
	`title_bs` text NOT NULL,
	`body_json` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`actor_id` text,
	`device_id` text,
	`shift_id` text,
	`business_date` text NOT NULL,
	`resolves_id` text,
	`created_at` text NOT NULL,
	`redacted_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `log_entries_created_idx` ON `log_entries` (`venue_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `log_entries_kind_idx` ON `log_entries` (`venue_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `log_entries_actor_idx` ON `log_entries` (`venue_id`,`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `log_entries_ref_idx` ON `log_entries` (`venue_id`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE INDEX `log_entries_shift_idx` ON `log_entries` (`venue_id`,`shift_id`);--> statement-breakpoint
CREATE INDEX `log_entries_resolves_idx` ON `log_entries` (`venue_id`,`resolves_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`tab_id` text NOT NULL,
	`shift_id` text,
	`client_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_fen` integer NOT NULL,
	`received_fen` integer,
	`tip_fen` integer DEFAULT 0 NOT NULL,
	`covers_json` text DEFAULT '[]' NOT NULL,
	`paid_by` text NOT NULL,
	`approved_by` text,
	`device_id` text,
	`reverses_id` text,
	`adjustment_id` text,
	`post_settle` integer DEFAULT 0 NOT NULL,
	`client_created_at` text,
	`client_created_at_adj` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_client_uq` ON `payments` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `payments_tab_idx` ON `payments` (`venue_id`,`tab_id`);--> statement-breakpoint
CREATE INDEX `payments_shift_user_idx` ON `payments` (`venue_id`,`shift_id`,`paid_by`,`method`);--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price_fen` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`changed_by` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_history_open_uq` ON `price_history` (`venue_id`,`product_id`) WHERE valid_to IS NULL;--> statement-breakpoint
CREATE INDEX `price_history_product_idx` ON `price_history` (`venue_id`,`product_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`borrowed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`venue_id`,`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_device_idx` ON `sessions` (`device_id`);--> statement-breakpoint
CREATE TABLE `shift_members` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`left_at_source` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shift_members_uq` ON `shift_members` (`venue_id`,`shift_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `shift_summaries` (
	`shift_id` text NOT NULL,
	`venue_id` text NOT NULL,
	`version` integer NOT NULL,
	`reason` text NOT NULL,
	`promet_fen` integer DEFAULT 0 NOT NULL,
	`cash_fen` integer DEFAULT 0 NOT NULL,
	`card_fen` integer DEFAULT 0 NOT NULL,
	`comp_fen` integer DEFAULT 0 NOT NULL,
	`void_count` integer DEFAULT 0 NOT NULL,
	`void_fen` integer DEFAULT 0 NOT NULL,
	`self_void_count` integer DEFAULT 0 NOT NULL,
	`self_void_fen` integer DEFAULT 0 NOT NULL,
	`unpaid_fen` integer DEFAULT 0 NOT NULL,
	`expected_cash_fen` integer DEFAULT 0 NOT NULL,
	`outstanding_fen` integer DEFAULT 0 NOT NULL,
	`counted_cash_fen` integer,
	`diff_fen` integer,
	`stock_variance_fen` integer DEFAULT 0 NOT NULL,
	`waste_fen` integer DEFAULT 0 NOT NULL,
	`bowls` integer DEFAULT 0 NOT NULL,
	`tobacco_g` real DEFAULT 0 NOT NULL,
	`coals` integer DEFAULT 0 NOT NULL,
	`by_category_json` text NOT NULL,
	`by_user_json` text NOT NULL,
	`computed_at` text NOT NULL,
	PRIMARY KEY(`shift_id`, `version`),
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shift_summaries_venue_idx` ON `shift_summaries` (`venue_id`,`shift_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`business_date` text NOT NULL,
	`opened_at` text NOT NULL,
	`opened_by` text NOT NULL,
	`auto_opened` integer DEFAULT 0 NOT NULL,
	`stock_custodian_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`closing_started_at` text,
	`closing_started_by` text,
	`closed_at` text,
	`closed_by` text,
	`closed_kind` text,
	`opening_float_override_fen` integer,
	`cash_counted_fen` integer,
	`card_total_fen` integer,
	`closing_note` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_one_open_uq` ON `shifts` (`venue_id`) WHERE status IN ('open','closing');--> statement-breakpoint
CREATE INDEX `shifts_venue_date_idx` ON `shifts` (`venue_id`,`business_date`,`opened_at`);--> statement-breakpoint
CREATE TABLE `stock_count_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`count_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`counted_packs` real,
	`counted_loose` real,
	`weighed_g` real,
	`counted_qty` real NOT NULL,
	`theoretical_qty` real NOT NULL,
	`variance_qty` real NOT NULL,
	`unit_cost_mfen` integer NOT NULL,
	`variance_fen` integer NOT NULL,
	`applied_adjust` real,
	`note` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`count_id`) REFERENCES `stock_counts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_count_lines_uq` ON `stock_count_lines` (`venue_id`,`count_id`,`stock_item_id`);--> statement-breakpoint
CREATE INDEX `stock_count_lines_item_idx` ON `stock_count_lines` (`venue_id`,`stock_item_id`,`count_id`);--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`kind` text NOT NULL,
	`phase` text NOT NULL,
	`shift_id` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`counted_by` text NOT NULL,
	`witnessed_by` text,
	`witnessed_at` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`override_by` text,
	`submitted_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_counts_shift_phase_uq` ON `stock_counts` (`venue_id`,`shift_id`,`phase`) WHERE phase IN ('open','close');--> statement-breakpoint
CREATE INDEX `stock_counts_shift_idx` ON `stock_counts` (`venue_id`,`shift_id`,`phase`);--> statement-breakpoint
CREATE INDEX `stock_counts_status_idx` ON `stock_counts` (`venue_id`,`status`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`task` text NOT NULL,
	`business_date` text NOT NULL,
	`ran_at` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_runs_uq` ON `task_runs` (`venue_id`,`task`,`business_date`);--> statement-breakpoint
CREATE TABLE `waiter_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`declared_fen` integer NOT NULL,
	`expected_at_declare_fen` integer NOT NULL,
	`breakdown_json` text NOT NULL,
	`summary_json` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`self_sealed` integer DEFAULT 0 NOT NULL,
	`unsent_reported_json` text DEFAULT '{}' NOT NULL,
	`device_id` text,
	`late` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waiter_settlements_uq` ON `waiter_settlements` (`venue_id`,`shift_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `waste_events` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`stock_item_id` text NOT NULL,
	`client_id` text NOT NULL,
	`qty` real NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`cost_fen` integer NOT NULL,
	`shift_id` text,
	`user_id` text NOT NULL,
	`needs_approval` integer DEFAULT 0 NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stock_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waste_events_client_uq` ON `waste_events` (`venue_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `waste_events_shift_idx` ON `waste_events` (`venue_id`,`shift_id`);--> statement-breakpoint
CREATE INDEX `waste_events_created_idx` ON `waste_events` (`venue_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `categories` ADD `kind` text DEFAULT 'ostalo' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `note_chips_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `comp_reason` text;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `authorised_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `order_lines` ADD `parent_line_id` text REFERENCES order_lines(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `shift_id` text REFERENCES shifts(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `shift_seq` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `client_created_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `client_created_at_adj` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `sync_lag_s` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `late_sync` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `post_settle` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `source` text DEFAULT 'app' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_shift_seq_uq` ON `orders` (`venue_id`,`shift_id`,`shift_seq`);--> statement-breakpoint
CREATE INDEX `orders_shift_locker_idx` ON `orders` (`venue_id`,`shift_id`,`locked_by`);--> statement-breakpoint
ALTER TABLE `products` ADD `short_name` text;--> statement-breakpoint
ALTER TABLE `products` ADD `search_aliases` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `shisha_grams_measured_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `staff_drink_allowed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `created_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `category_id` text REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `stock_items` ADD `brand` text;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `avg_cost_mfen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `last_cost_mfen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `count_method` text DEFAULT 'count' NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `tare_g` real;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `tolerance_qty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `par_qty` real;--> statement-breakpoint
ALTER TABLE `stock_items` ADD `available` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `stock_items_category_idx` ON `stock_items` (`venue_id`,`category_id`);--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `unit_cost_mfen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `shift_id` text REFERENCES shifts(id);--> statement-breakpoint
CREATE INDEX `stock_movements_shift_idx` ON `stock_movements` (`venue_id`,`shift_id`);--> statement-breakpoint
ALTER TABLE `tabs` ADD `shift_id` text REFERENCES shifts(id);--> statement-breakpoint
ALTER TABLE `tabs` ADD `assigned_to` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tabs` ADD `offered_to` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `tabs` ADD `late_sync` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tabs` ADD `unpaid_reason` text;--> statement-breakpoint
ALTER TABLE `tabs` ADD `unpaid_by` text;--> statement-breakpoint
ALTER TABLE `tabs` ADD `unpaid_approved_by` text;--> statement-breakpoint
ALTER TABLE `tabs` ADD `pending_review` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tabs` ADD `unpaid_client_id` text;--> statement-breakpoint
ALTER TABLE `tabs` ADD `fiscal_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `tabs` ADD `fiscal_ref` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_unpaid_client_uq` ON `tabs` (`venue_id`,`unpaid_client_id`) WHERE unpaid_client_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tabs_shift_idx` ON `tabs` (`venue_id`,`shift_id`,`status`);--> statement-breakpoint
CREATE INDEX `tabs_assigned_idx` ON `tabs` (`venue_id`,`assigned_to`,`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `pin_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_len` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_set_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_pepper_v` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_chat_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `log_seen_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `created_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`) WHERE email IS NOT NULL;--> statement-breakpoint
ALTER TABLE `venues` ADD `settings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- ===========================================================================
-- Hand-written tail (docs/BACKEND.md §2 "Migrations", §3.1).
--
-- drizzle-kit writes DDL. These four statements are the *data* half of the
-- migration and no generator can infer them, so they are appended by hand and
-- must survive every future `drizzle-kit generate` (append below, never above).
--
-- Why an UPDATE and not `ADD COLUMN … NOT NULL`: under `foreign_keys = ON` —
-- which `openDatabase()` switches on before migrating — SQLite refuses
-- "Cannot add a REFERENCES column with non-NULL default value". So a new
-- mandatory FK column is added nullable, backfilled here, and made mandatory by
-- a BEFORE INSERT trigger in `triggers.sql` (`tabs_assigned_required`).
-- ===========================================================================

-- **Drop the guard this migration is about to invalidate, first.**
-- `applyTriggers()` runs *after* `migrate()`, so while these UPDATEs execute the
-- database still carries Korak 1's `tabs_update_guard` — a trigger that allows
-- exactly one shape of tab UPDATE, `open -> paid`. The `assigned_to` backfill
-- below is not that shape, so on a café's real database (which has paid tabs in
-- it) the migration would abort with "tabs: only open -> paid with
-- closed_at/closed_by" and the server would fail to boot. `triggers.sql` drops
-- it too, for the databases that never had it; this line is what lets the
-- upgrade itself get past it.
DROP TRIGGER IF EXISTS tabs_update_guard;--> statement-breakpoint

-- Korak 1's role value 'owner' becomes 'admin'. The *paths* that name the owner
-- dashboard keep the word (/api/owner/live); the role value never does again.
UPDATE users SET role = 'admin' WHERE role = 'owner';--> statement-breakpoint

-- The two `created_at` columns arrived with DEFAULT '' because an existing row
-- needs *some* value; '' is not a date, so give the rows that already exist the
-- moment of the migration rather than a string that sorts before everything.
UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at = '';--> statement-breakpoint
UPDATE products SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at = '';--> statement-breakpoint

-- `assigned_to` is nullable in DDL and never NULL in fact. Korak 1 tabs had no
-- assignee, and the waiter who opened the tab is exactly who was carrying it.
UPDATE tabs SET assigned_to = opened_by WHERE assigned_to IS NULL;
