CREATE TABLE "oauth_client_revocation" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"not_before" timestamp NOT NULL,
	CONSTRAINT "oauth_client_revocation_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "oauth_client_revocation" ADD CONSTRAINT "oauth_client_revocation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;