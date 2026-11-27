ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "share_origin" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "shared_by_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_shared_by_user_id_users_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
