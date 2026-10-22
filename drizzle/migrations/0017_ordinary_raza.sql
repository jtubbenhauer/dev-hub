CREATE TABLE `session_title_states` (
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`last_auto_title_turn` integer DEFAULT 0 NOT NULL,
	`last_generated_title` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `session_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
