CREATE TABLE `recovered_messages` (
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`message_json` text NOT NULL,
	`recovered_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`, `session_id`, `message_id`)
);
--> statement-breakpoint
CREATE INDEX `recovered_messages_lookup_idx` ON `recovered_messages` (`user_id`,`workspace_id`,`session_id`,`sequence`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cached_messages` (
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`messages_json` text NOT NULL,
	`authoritative_message_ids_json` text DEFAULT '[]' NOT NULL,
	`cached_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`, `session_id`)
);
--> statement-breakpoint
INSERT INTO `__new_cached_messages`("session_id", "workspace_id", "user_id", "messages_json", "authoritative_message_ids_json", "cached_at") SELECT "session_id", "workspace_id", "user_id", "messages_json", '[]', "cached_at" FROM `cached_messages`;--> statement-breakpoint
DROP TABLE `cached_messages`;--> statement-breakpoint
ALTER TABLE `__new_cached_messages` RENAME TO `cached_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cached_messages_workspace_id_idx` ON `cached_messages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `cached_messages_user_id_idx` ON `cached_messages` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_cached_sessions` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`parent_id` text,
	`status` text,
	`created_at` integer,
	`updated_at` integer,
	`cached_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_cached_sessions`("id", "workspace_id", "user_id", "title", "parent_id", "status", "created_at", "updated_at", "cached_at") SELECT "id", "workspace_id", "user_id", "title", "parent_id", "status", "created_at", "updated_at", "cached_at" FROM `cached_sessions`;--> statement-breakpoint
DROP TABLE `cached_sessions`;--> statement-breakpoint
ALTER TABLE `__new_cached_sessions` RENAME TO `cached_sessions`;--> statement-breakpoint
CREATE INDEX `cached_sessions_workspace_id_cached_at_idx` ON `cached_sessions` (`workspace_id`,`cached_at`);