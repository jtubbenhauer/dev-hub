DROP TABLE `passkeys`;--> statement-breakpoint
DROP TABLE `totp_secrets`;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `backend` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `opencode_url` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `agent_url` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `provider_meta` text;