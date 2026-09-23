CREATE TABLE `calorie_auto_record` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`item_id` int NOT NULL,
	`time_of_day` varchar(5) NOT NULL,
	`quantity` int NOT NULL,
	`enabled` tinyint NOT NULL DEFAULT 1,
	`tz_offset_minutes` int NOT NULL,
	`next_run_at` timestamp NOT NULL,
	`created` timestamp NOT NULL,
	`updated` timestamp NOT NULL,
	CONSTRAINT `calorie_auto_record_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `calorie_auto_record` ADD CONSTRAINT `calorie_auto_record_item_id_calorie_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calorie_item`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `calorie_auto_record_user_id_idx` ON `calorie_auto_record` (`user_id`);
