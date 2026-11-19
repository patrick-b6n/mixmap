CREATE TABLE `links` (
	`from_track` text NOT NULL,
	`to_track` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`rating` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`from_track`, `to_track`),
	FOREIGN KEY (`from_track`) REFERENCES `tracks`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_track`) REFERENCES `tracks`(`key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "links_rating" CHECK("links"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "links_not_self" CHECK("links"."from_track" <> "links"."to_track")
);
--> statement-breakpoint
CREATE INDEX `links_to_track` ON `links` (`to_track`);--> statement-breakpoint
CREATE TABLE `manual_matches` (
	`track_key` text PRIMARY KEY NOT NULL,
	`rekordbox_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`track_key` text PRIMARY KEY NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`track_key`) REFERENCES `tracks`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tombstones` (
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `id`)
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`key` text PRIMARY KEY NOT NULL,
	`artist` text NOT NULL,
	`title` text NOT NULL,
	`duration` integer NOT NULL,
	`rekordbox_id` text,
	`missing` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
