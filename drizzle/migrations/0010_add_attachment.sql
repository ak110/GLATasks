CREATE TABLE `attachment` (
	`id` int AUTO_INCREMENT NOT NULL,
	`task_id` int NOT NULL,
	`filename` varchar(255) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size` int NOT NULL,
	`data` mediumblob NOT NULL,
	`created` timestamp NOT NULL,
	CONSTRAINT `attachment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `task_id_idx` ON `attachment` (`task_id`);
