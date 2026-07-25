-- timer テーブル: ring_seconds カラム追加（鳴動を継続する秒数。既定値は3秒）
ALTER TABLE `timer` ADD `ring_seconds` int NOT NULL DEFAULT 3;--> statement-breakpoint

-- 既存の keep_ringing=1（止めるまで鳴り続ける）のタイマーを上限値の3600秒へ読み替える
-- keep_ringing=0 のタイマーは既定値の3秒のままとする
UPDATE `timer` SET `ring_seconds` = 3600 WHERE `keep_ringing` = 1;--> statement-breakpoint

-- timer.keep_ringing カラム削除
ALTER TABLE `timer` DROP COLUMN `keep_ringing`;--> statement-breakpoint

-- user.preferences（JSON）の利用者既定値も同じ規則で読み替え、旧キー keep_ringing を除去する
UPDATE `user` SET `preferences` = JSON_REMOVE(JSON_SET(`preferences`, '$.ring_seconds', IF(JSON_EXTRACT(`preferences`, '$.keep_ringing') = true, 3600, 3)), '$.keep_ringing') WHERE JSON_CONTAINS_PATH(`preferences`, 'one', '$.keep_ringing');
