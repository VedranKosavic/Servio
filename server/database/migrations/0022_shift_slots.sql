DROP INDEX `shifts_one_open_uq`;--> statement-breakpoint
ALTER TABLE `shifts` ADD `template_id` text REFERENCES shift_templates(id);--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_one_open_uq` ON `shifts` (`venue_id`,`business_date`,`template_id`) WHERE status IN ('open','closing');--> statement-breakpoint
ALTER TABLE `sessions` ADD `shift_id` text REFERENCES shifts(id);