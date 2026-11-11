CREATE TABLE `auth_challenge` (
	`id` varchar(64) NOT NULL,
	`purpose` varchar(32) NOT NULL,
	`user_id` int,
	`user_name` varchar(80),
	`handle` varchar(64),
	`generation` int NOT NULL DEFAULT 0,
	`challenge` varchar(128) NOT NULL,
	`data` mediumtext NOT NULL DEFAULT '{}',
	`expires` timestamp NOT NULL,
	`consumed` timestamp,
	CONSTRAINT `auth_challenge_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` varchar(1400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`user_id` int NOT NULL,
	`public_key` mediumtext NOT NULL,
	`counter` bigint unsigned NOT NULL,
	`transports` varchar(255) NOT NULL,
	`name` varchar(100) NOT NULL,
	`created` timestamp NOT NULL,
	`last_used` timestamp,
	CONSTRAINT `passkey_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recovery_code` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`digest` varchar(64) NOT NULL,
	`used` timestamp,
	`created` timestamp NOT NULL,
	CONSTRAINT `recovery_code_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `user` MODIFY COLUMN `pass_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `user` ADD `session_generation` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `webauthn_handle` varchar(64);--> statement-breakpoint
ALTER TABLE `user` ADD `recovery_failures` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `recovery_locked_until` timestamp;--> statement-breakpoint
ALTER TABLE `passkey` ADD CONSTRAINT `passkey_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recovery_code` ADD CONSTRAINT `recovery_code_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;
