CREATE TABLE `admin_claim_attempts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` integer NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`time` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_group_date` ON `events` (`group_id`,`date`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`eios_url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_code_unique` ON `groups` (`code`);--> statement-breakpoint
INSERT OR IGNORE INTO `groups` (`id`, `code`, `eios_url`) VALUES
	(8954, '26-ИСбо-1', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/8954'),
	(8881, '26-ИСбо-2', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/8881'),
	(9000, '26-ИСбо-3', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/9000'),
	(8953, '26-ИСбо-4', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/8953'),
	(8878, '26-ИСбо-5', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/8878'),
	(8949, '26-ИБбо-6', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/8949'),
	(8948, '26-ПМбо-1', 'https://eios.kosgos.ru/WebApp/#/Rasp/Group/8948');--> statement-breakpoint
CREATE TABLE `homework` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` integer NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`due` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_homework_group_due` ON `homework` (`group_id`,`due`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`group_id` integer,
	`role` text DEFAULT 'student' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('student', 'group_admin', 'super_admin'))
);
--> statement-breakpoint
CREATE INDEX `idx_users_group_id` ON `users` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_single_super_admin` ON `users` (`role`) WHERE "users"."role" = 'super_admin';
