CREATE TABLE `bookmarks` (
	`question_id` integer PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `case_studies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `case_studies_code_unique` ON `case_studies` (`code`);--> statement-breakpoint
CREATE TABLE `certification_domains` (
	`certification_id` integer NOT NULL,
	`domain_id` integer NOT NULL,
	`weight` integer NOT NULL,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cert_domains_idx` ON `certification_domains` (`certification_id`,`domain_id`);--> statement-breakpoint
CREATE TABLE `certifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`name_vi` text NOT NULL,
	`body` text NOT NULL,
	`tier` text NOT NULL,
	`framework_id` integer NOT NULL,
	`question_count` integer NOT NULL,
	`time_limit_sec` integer NOT NULL,
	`pass_threshold_percent` integer NOT NULL,
	`pass_threshold_source` text NOT NULL,
	`proficiency_level` integer NOT NULL,
	`proficiency_label` text NOT NULL,
	`allows_case_studies` integer NOT NULL,
	`question_types` text NOT NULL,
	`eligibility` text NOT NULL,
	`accent` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`framework_id`) REFERENCES `frameworks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certifications_code_unique` ON `certifications` (`code`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`framework_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`name_vi` text NOT NULL,
	`reference` text,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`framework_id`) REFERENCES `frameworks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_framework_code_idx` ON `domains` (`framework_id`,`code`);--> statement-breakpoint
CREATE TABLE `exam_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`certification_id` integer NOT NULL,
	`mode` text NOT NULL,
	`domain_filter_id` integer,
	`question_count` integer NOT NULL,
	`time_limit_sec` integer,
	`shuffle_seed` integer NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`submitted_at` integer,
	`score` integer,
	FOREIGN KEY (`certification_id`) REFERENCES `certifications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`domain_filter_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `flashcard_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`grade` integer NOT NULL,
	`interval_days_after` integer NOT NULL,
	`reviewed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flashcard_states` (
	`card_id` integer PRIMARY KEY NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`repetitions` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`due_at` integer NOT NULL,
	`last_reviewed_at` integer,
	FOREIGN KEY (`card_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `flashcard_states_due_idx` ON `flashcard_states` (`due_at`);--> statement-breakpoint
CREATE TABLE `flashcards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`framework_id` integer NOT NULL,
	`deck` text NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`domain_id` integer,
	`source_ref` text,
	FOREIGN KEY (`framework_id`) REFERENCES `frameworks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flashcards_code_unique` ON `flashcards` (`code`);--> statement-breakpoint
CREATE INDEX `flashcards_deck_idx` ON `flashcards` (`framework_id`,`deck`);--> statement-breakpoint
CREATE TABLE `frameworks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`domain_label` text NOT NULL,
	`domain_label_vi` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frameworks_code_unique` ON `frameworks` (`code`);--> statement-breakpoint
CREATE TABLE `question_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`label` text NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer NOT NULL,
	`rationale` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_options_q_label_idx` ON `question_options` (`question_id`,`label`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`domain_id` integer NOT NULL,
	`source_ref` text NOT NULL,
	`source_task` text NOT NULL,
	`difficulty` integer DEFAULT 2 NOT NULL,
	`case_study_id` integer,
	`stem` text NOT NULL,
	`explanation` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_study_id`) REFERENCES `case_studies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_code_unique` ON `questions` (`code`);--> statement-breakpoint
CREATE INDEX `questions_domain_status_idx` ON `questions` (`domain_id`,`status`);--> statement-breakpoint
CREATE TABLE `session_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`position` integer NOT NULL,
	`selected_option_id` integer,
	`is_correct` integer,
	`flagged` integer DEFAULT false NOT NULL,
	`time_spent_sec` integer DEFAULT 0 NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `exam_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selected_option_id`) REFERENCES `question_options`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_questions_pos_idx` ON `session_questions` (`session_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_questions_q_idx` ON `session_questions` (`session_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `user_notes` (
	`question_id` integer PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
