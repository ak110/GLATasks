ALTER TABLE `timer` ADD `keep_ringing` tinyint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `preferences` mediumtext DEFAULT '{}' NOT NULL;
