PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_command_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`command` text NOT NULL,
	`exit_code` integer,
	`executed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_command_history`("id", "workspace_id", "command", "exit_code", "executed_at") SELECT "id", "workspace_id", "command", "exit_code", "executed_at" FROM `command_history`;--> statement-breakpoint
DROP TABLE `command_history`;--> statement-breakpoint
ALTER TABLE `__new_command_history` RENAME TO `command_history`;--> statement-breakpoint
PRAGMA foreign_keys=ON;