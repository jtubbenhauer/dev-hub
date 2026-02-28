CREATE TABLE `review_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`review_id` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`old_path` text,
	`reviewed` integer DEFAULT false NOT NULL,
	`diff_hash` text,
	`reviewed_at` integer,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`mode` text NOT NULL,
	`target_ref` text,
	`base_ref` text,
	`merge_base` text,
	`total_files` integer DEFAULT 0 NOT NULL,
	`reviewed_files` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text NOT NULL;