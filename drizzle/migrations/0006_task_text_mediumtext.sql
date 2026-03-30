-- task テーブル: text カラムを TEXT → MEDIUMTEXT に変更（文字数制限緩和）
ALTER TABLE `task` MODIFY `text` mediumtext NOT NULL;
