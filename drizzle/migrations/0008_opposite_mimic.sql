CREATE TABLE `file_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`file_path` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`body` text NOT NULL,
	`content_snapshot` text,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
