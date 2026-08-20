CREATE TABLE "queue_items" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"position" double precision NOT NULL,
	"payload" jsonb NOT NULL,
	"loop" boolean DEFAULT false NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "current_item_id" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "current_state" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "current_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "tier" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_items_board_position_idx" ON "queue_items" USING btree ("board_id","position");