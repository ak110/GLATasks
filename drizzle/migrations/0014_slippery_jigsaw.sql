CREATE TABLE `calorie_item` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`kcal` decimal(12,4) NOT NULL,
	`note` mediumtext NOT NULL DEFAULT '',
	`created` timestamp NOT NULL,
	`updated` timestamp NOT NULL,
	CONSTRAINT `calorie_item_id` PRIMARY KEY(`id`),
	CONSTRAINT `calorie_item_user_name_unique` UNIQUE(`user_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `calorie_record` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`item_id` int NOT NULL,
	`consumed_at` timestamp NOT NULL,
	`quantity` decimal(12,4) NOT NULL,
	`created` timestamp NOT NULL,
	`updated` timestamp NOT NULL,
	CONSTRAINT `calorie_record_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `calorie_record` ADD CONSTRAINT `calorie_record_item_id_calorie_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calorie_item`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `calorie_record_user_consumed_id_idx` ON `calorie_record` (`user_id`,`consumed_at`,`id`);
