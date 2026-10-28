CREATE TABLE `budget_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`from_category_id` integer NOT NULL,
	`to_category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`user_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`from_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transfers_date` ON `budget_transfers` (`date`);--> statement-breakpoint
CREATE TABLE `carryovers` (
	`month` text NOT NULL,
	`category_id` integer NOT NULL,
	`target_category_id` integer NOT NULL,
	PRIMARY KEY(`month`, `category_id`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `installment_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_transaction_id` integer NOT NULL,
	`complement_transaction_id` integer,
	`merchant_key` text NOT NULL,
	`category_id` integer NOT NULL,
	`count` integer NOT NULL,
	`total` integer NOT NULL,
	`installment` integer NOT NULL,
	`mode` text DEFAULT 'upfront' NOT NULL,
	`trip_date` text,
	`assumed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`first_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`complement_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`category_id` integer,
	`user_id` integer,
	`rank` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'wanted' NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `wishlist_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`url` text NOT NULL,
	`seller` text NOT NULL,
	`title` text,
	`price` integer,
	`shipping` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`checked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `wishlist_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `code` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `group_name` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `accrual` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `rollover` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `owner_user_id` integer REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_code_unique` ON `categories` (`code`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `installment_plan_id` integer;