CREATE TABLE `cached_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`parent_id` text,
	`status` text,
	`created_at` integer,
	`updated_at` integer,
	`cached_at` integer NOT NULL
);
