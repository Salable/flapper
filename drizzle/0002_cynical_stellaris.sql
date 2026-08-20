CREATE TABLE "queues" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'live' NOT NULL,
	"cycle_anchor_ms" bigint,
	"cycle_ms" integer,
	"dormancy_display" text DEFAULT 'card' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_items" DROP CONSTRAINT "queue_items_board_id_boards_id_fk";
--> statement-breakpoint
DROP INDEX "queue_items_board_position_idx";--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "queue_id" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "queue_attached_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "queue_id" text;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "computed_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "play_at_ms" bigint;--> statement-breakpoint
INSERT INTO "queues" ("id", "owner_id", "name", "created_at") SELECT "id", "owner_id", '', "created_at" FROM "boards";--> statement-breakpoint
UPDATE "boards" SET "queue_id" = "id", "queue_attached_at" = "created_at";--> statement-breakpoint
UPDATE "queue_items" SET "queue_id" = "board_id";--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "queue_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ALTER COLUMN "queue_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_items_queue_position_idx" ON "queue_items" USING btree ("queue_id","position");--> statement-breakpoint
ALTER TABLE "queue_items" DROP COLUMN "board_id";
