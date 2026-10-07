-- FastAPI由来のDBと初期migration由来のDBを、同じ索引・外部キーへそろえる。
ALTER TABLE `list` DROP FOREIGN KEY IF EXISTS `list_ibfk_1`;
--> statement-breakpoint
ALTER TABLE `task` DROP FOREIGN KEY IF EXISTS `task_ibfk_1`;
--> statement-breakpoint
-- 到達できない行は退避せず除去する。祖先が無い子も、RESTRICTに備えて先に除去する。
DELETE a FROM `attachment` a
LEFT JOIN `task` t ON t.id = a.task_id
LEFT JOIN `list` l ON l.id = t.list_id
LEFT JOIN `user` u ON u.id = l.user_id
WHERE t.id IS NULL OR l.id IS NULL OR u.id IS NULL;
--> statement-breakpoint
DELETE s FROM `schedule` s
LEFT JOIN `list` l ON l.id = s.list_id
LEFT JOIN `user` u ON u.id = l.user_id
WHERE l.id IS NULL OR u.id IS NULL;
--> statement-breakpoint
DELETE t FROM `task` t
LEFT JOIN `list` l ON l.id = t.list_id
LEFT JOIN `user` u ON u.id = l.user_id
WHERE l.id IS NULL OR u.id IS NULL;
--> statement-breakpoint
DELETE l FROM `list` l LEFT JOIN `user` u ON u.id = l.user_id WHERE u.id IS NULL;
--> statement-breakpoint
DELETE t FROM `timer` t LEFT JOIN `user` u ON u.id = t.user_id WHERE u.id IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `user_id` ON `list`;
--> statement-breakpoint
DROP INDEX IF EXISTS `list_id` ON `task`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_id_idx` ON `list` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `list_id_idx` ON `task` (`list_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_id_idx` ON `timer` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_id_idx` ON `attachment` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `list_id_idx` ON `schedule` (`list_id`);
--> statement-breakpoint
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_task_id_task_id_fk` FOREIGN KEY IF NOT EXISTS (`task_id`) REFERENCES `task`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE `list` ADD CONSTRAINT `list_user_id_user_id_fk` FOREIGN KEY IF NOT EXISTS (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE `schedule` ADD CONSTRAINT `schedule_list_id_list_id_fk` FOREIGN KEY IF NOT EXISTS (`list_id`) REFERENCES `list`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE `task` ADD CONSTRAINT `task_list_id_list_id_fk` FOREIGN KEY IF NOT EXISTS (`list_id`) REFERENCES `list`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE `timer` ADD CONSTRAINT `timer_user_id_user_id_fk` FOREIGN KEY IF NOT EXISTS (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
-- 利用者設定の公開名と保存値を同時に移行する。新キーがある場合はその値を優先する。
UPDATE `user` SET preferences = JSON_REMOVE(
  IF(JSON_CONTAINS_PATH(preferences, 'one', '$.ringSeconds'), preferences,
    JSON_SET(preferences, '$.ringSeconds', JSON_EXTRACT(preferences, '$.ring_seconds'))),
  '$.ring_seconds')
WHERE JSON_VALID(preferences) AND JSON_CONTAINS_PATH(preferences, 'one', '$.ring_seconds');
--> statement-breakpoint
UPDATE `user` SET preferences = JSON_REMOVE(
  IF(JSON_CONTAINS_PATH(preferences, 'one', '$.baseSeconds'), preferences,
    JSON_SET(preferences, '$.baseSeconds', JSON_EXTRACT(preferences, '$.base_seconds'))),
  '$.base_seconds')
WHERE JSON_VALID(preferences) AND JSON_CONTAINS_PATH(preferences, 'one', '$.base_seconds');
--> statement-breakpoint
UPDATE `user` SET preferences = JSON_REMOVE(
  IF(JSON_CONTAINS_PATH(preferences, 'one', '$.adjustMinutes'), preferences,
    JSON_SET(preferences, '$.adjustMinutes', JSON_EXTRACT(preferences, '$.adjust_minutes'))),
  '$.adjust_minutes')
WHERE JSON_VALID(preferences) AND JSON_CONTAINS_PATH(preferences, 'one', '$.adjust_minutes');
--> statement-breakpoint
UPDATE `user` SET preferences = JSON_REMOVE(
  IF(JSON_CONTAINS_PATH(preferences, 'one', '$.calorieGoalKcal'), preferences,
    JSON_SET(preferences, '$.calorieGoalKcal', JSON_EXTRACT(preferences, '$.calorie_goal_kcal'))),
  '$.calorie_goal_kcal')
WHERE JSON_VALID(preferences) AND JSON_CONTAINS_PATH(preferences, 'one', '$.calorie_goal_kcal');
