CREATE TABLE `schedule` (
	`id` int AUTO_INCREMENT NOT NULL,
	`list_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`tags` mediumtext NOT NULL DEFAULT '[]',
	`rrule` mediumtext NOT NULL,
	`last_fired` timestamp,
	`enabled` tinyint NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	`created` timestamp NOT NULL,
	`updated` timestamp NOT NULL,
	CONSTRAINT `schedule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `task` ADD `kind` varchar(255) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX `list_id_idx` ON `schedule` (`list_id`);
