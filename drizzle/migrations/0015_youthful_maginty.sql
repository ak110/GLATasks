UPDATE `calorie_item` SET `kcal` = CEILING(`kcal`);--> statement-breakpoint
UPDATE `calorie_record` SET `quantity` = CEILING(`quantity`);--> statement-breakpoint
UPDATE `user` SET `preferences` = JSON_SET(`preferences`, '$.calorie_goal_kcal', CEILING(JSON_VALUE(`preferences`, '$.calorie_goal_kcal'))) WHERE JSON_VALUE(`preferences`, '$.calorie_goal_kcal') IS NOT NULL;--> statement-breakpoint
ALTER TABLE `calorie_item` MODIFY COLUMN `kcal` int NOT NULL;--> statement-breakpoint
ALTER TABLE `calorie_record` MODIFY COLUMN `quantity` int NOT NULL;
