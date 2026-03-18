CREATE TABLE `pinned_sessions` (
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`pinned_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`workspace_id`, `session_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `workspaces` ADD `shell_command` text;