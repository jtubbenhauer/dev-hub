CREATE INDEX `audit_log_user_id_created_at_idx` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `cached_sessions_workspace_id_cached_at_idx` ON `cached_sessions` (`workspace_id`,`cached_at`);--> statement-breakpoint
CREATE INDEX `command_history_workspace_id_executed_at_idx` ON `command_history` (`workspace_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `file_comments_workspace_id_file_path_idx` ON `file_comments` (`workspace_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `review_files_review_id_idx` ON `review_files` (`review_id`);--> statement-breakpoint
CREATE INDEX `reviews_workspace_id_idx` ON `reviews` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `workspaces_user_id_idx` ON `workspaces` (`user_id`);