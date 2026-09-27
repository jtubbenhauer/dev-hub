CREATE TABLE `omo_session_index` (
	`workspace_id` text NOT NULL,
	`durable_id` text NOT NULL,
	`session_path` text,
	`parent_durable_id` text,
	`kind` text NOT NULL,
	`agent` text,
	`category` text,
	`context` text,
	`context_authoritative` integer DEFAULT 0 NOT NULL,
	`replaced_by_durable_id` text,
	`title` text NOT NULL,
	`created_ms` integer NOT NULL,
	`updated_ms` integer NOT NULL,
	`leaf_known` integer DEFAULT 0 NOT NULL,
	`leaf_entry_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `durable_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `omo_session_index_workspace_idx` ON `omo_session_index` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `omo_session_index_parent_idx` ON `omo_session_index` (`workspace_id`,`parent_durable_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `omo_session_index_path_uq` ON `omo_session_index` (`workspace_id`,`session_path`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `engine` text;