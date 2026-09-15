CREATE TABLE `roster_pattern` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`template_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_pattern_cell_uq` ON `roster_pattern` (`venue_id`,`weekday`,`template_id`,`user_id`);
--> statement-breakpoint
-- Hand-written, after the generated DDL: seed the pattern once from the plan
-- that was in force — each venue's most recent *published* week. Every regular
-- person in it (not a one-off swap cover, not removed; an active person on an
-- active template) lands on the weekday he worked, at most two per cell, the
-- earliest-written two when a cell had more. A venue that never published a
-- week starts with an empty pattern. `id` is a random v4-shaped uuid, because
-- `routeKey` only turns a uuid path segment into `:id`.
INSERT INTO `roster_pattern` (`id`, `venue_id`, `weekday`, `template_id`, `user_id`, `created_by`, `created_at`)
SELECT
  lower(substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12)),
  venue_id, weekday, template_id, user_id, created_by, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT hex(randomblob(16)) AS h, c.*,
    ROW_NUMBER() OVER (PARTITION BY c.venue_id, c.weekday, c.template_id ORDER BY c.first_at, c.user_id) AS seat
  FROM (
    SELECT a.venue_id,
      CASE CAST(strftime('%w', a.work_date) AS INTEGER) WHEN 0 THEN 7 ELSE CAST(strftime('%w', a.work_date) AS INTEGER) END AS weekday,
      a.template_id, a.user_id,
      COALESCE(w.published_by, w.created_by) AS created_by,
      MIN(a.created_at) AS first_at
    FROM `roster_assignments` a
    JOIN `roster_weeks` w
      ON w.venue_id = a.venue_id
     AND w.week_start = (SELECT MAX(w2.week_start) FROM `roster_weeks` w2
                         WHERE w2.venue_id = a.venue_id AND w2.published_at IS NOT NULL)
    JOIN `users` u ON u.id = a.user_id AND u.active = 1
    JOIN `shift_templates` t ON t.id = a.template_id AND t.active = 1
    WHERE a.work_date >= w.week_start
      AND a.work_date <= date(w.week_start, '+6 days')
      AND a.origin <> 'swap'
      AND a.status <> 'removed'
    GROUP BY a.venue_id, weekday, a.template_id, a.user_id
  ) c
)
WHERE seat <= 2;