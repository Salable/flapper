ALTER TABLE "boards" ADD COLUMN "type" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "schedule" jsonb;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "expires_at_ms" bigint;--> statement-breakpoint
INSERT INTO "queues" ("id", "owner_id", "name")
SELECT b."id", b."owner_id", ''
FROM "boards" b
WHERE EXISTS (
  SELECT 1 FROM "boards" p
  WHERE p."queue_id" = b."queue_id" AND p."id" <> b."id"
    AND (p."queue_attached_at" < b."queue_attached_at"
         OR (p."queue_attached_at" = b."queue_attached_at" AND p."id" < b."id"))
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "boards" b SET "queue_id" = b."id", "queue_attached_at" = now()
WHERE EXISTS (
  SELECT 1 FROM "boards" p
  WHERE p."queue_id" = b."queue_id" AND p."id" <> b."id"
    AND (p."queue_attached_at" < b."queue_attached_at"
         OR (p."queue_attached_at" = b."queue_attached_at" AND p."id" < b."id"))
);--> statement-breakpoint
DELETE FROM "queue_items"
WHERE "play_at_ms" IS NOT NULL
  AND "play_at_ms" + COALESCE("computed_duration_ms", 0) < (extract(epoch from now()) * 1000);--> statement-breakpoint
ALTER TABLE "queue_items" DROP COLUMN "play_at_ms";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "cycle_anchor_ms";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "cycle_ms";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "dormancy_display";
