CREATE TABLE `event_entities` (
	`event_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_entities_entity_idx` ON `event_entities` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `event_tags` (
	`event_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`event_id`, `tag`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_tags_tag_idx` ON `event_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`turn` integer NOT NULL,
	`kind` text NOT NULL,
	`visibility` text NOT NULL,
	`cause_id` text,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_turn_idx` ON `events` (`turn`);--> statement-breakpoint
CREATE INDEX `events_kind_idx` ON `events` (`kind`);--> statement-breakpoint
CREATE INDEX `events_cause_idx` ON `events` (`cause_id`);--> statement-breakpoint
CREATE TABLE `seed_entities` (
	`seed_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`seed_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`seed_id`) REFERENCES `seeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seed_entities_entity_idx` ON `seed_entities` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `seed_tags` (
	`seed_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`seed_id`, `tag`),
	FOREIGN KEY (`seed_id`) REFERENCES `seeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seed_tags_tag_idx` ON `seed_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `seeds` (
	`id` text PRIMARY KEY NOT NULL,
	`planted_turn` integer NOT NULL,
	`wake_turn` integer NOT NULL,
	`status` text NOT NULL,
	`fired_turn` integer,
	`origin_event_id` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `seeds_status_wake_idx` ON `seeds` (`status`,`wake_turn`);--> statement-breakpoint
CREATE INDEX `seeds_origin_idx` ON `seeds` (`origin_event_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`turn` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`body` text NOT NULL,
	`saved_at` integer NOT NULL
);
