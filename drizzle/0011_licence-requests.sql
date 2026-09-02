CREATE TABLE "licence_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"need" text NOT NULL,
	"message" text NOT NULL,
	"contact" text,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "licence_requests" ADD CONSTRAINT "licence_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "licence_requests_user_idx" ON "licence_requests" USING btree ("user_id");