ALTER TABLE "oauth_states" ADD COLUMN "connect_provider" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "new_password_hash" text;--> statement-breakpoint
CREATE INDEX "identities_provider_email_normalized_idx" ON "identities" USING btree (lower(btrim("provider_email")));--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_connect_provider_known" CHECK ("oauth_states"."connect_provider" in ('google', 'facebook'));--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_connect_provider_shape" CHECK ("oauth_states"."connect_provider" is null or ("oauth_states"."purpose" = 'reauthenticate' and "oauth_states"."connect_provider" <> "oauth_states"."provider"));--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_new_password_hash_shape" CHECK ("oauth_states"."new_password_hash" is null or ("oauth_states"."purpose" = 'reauthenticate' and "oauth_states"."connect_provider" is null));