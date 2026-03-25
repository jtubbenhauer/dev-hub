CREATE TABLE `cached_messages` (
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`messages_json` text NOT NULL,
	`cached_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `workspace_id`)
);
--> statement-breakpoint
CREATE INDEX `cached_messages_workspace_id_idx` ON `cached_messages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `cached_messages_user_id_idx` ON `cached_messages` (`user_id`);