CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "consents_purpose_known" CHECK ("consents"."purpose" in ('service_use')),
	CONSTRAINT "consents_policy_version_length" CHECK (char_length("consents"."policy_version") between 1 and 64),
	CONSTRAINT "consents_revoked_after_granted" CHECK ("consents"."revoked_at" is null or "consents"."revoked_at" >= "consents"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_outbox_kind_known" CHECK ("email_outbox"."kind" in ('verify_email', 'verify_reminder', 'reset_password', 'signup_notice', 'password_changed')),
	CONSTRAINT "email_outbox_to_email_normalized" CHECK ("email_outbox"."to_email" = lower(btrim("email_outbox"."to_email"))),
	CONSTRAINT "email_outbox_to_email_length" CHECK (char_length("email_outbox"."to_email") between 3 and 254),
	CONSTRAINT "email_outbox_attempts_range" CHECK ("email_outbox"."attempts" between 0 and 8),
	CONSTRAINT "email_outbox_last_error_length" CHECK (char_length("email_outbox"."last_error") <= 64)
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"email" text NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "email_tokens_user_purpose_unique" UNIQUE("user_id","purpose"),
	CONSTRAINT "email_tokens_token_hash_format" CHECK ("email_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_tokens_purpose_known" CHECK ("email_tokens"."purpose" in ('verify_email', 'reset_password')),
	CONSTRAINT "email_tokens_failed_attempts_range" CHECK ("email_tokens"."failed_attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"provider_email" text,
	"email_verified" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identities_provider_subject_unique" UNIQUE("provider","subject"),
	CONSTRAINT "identities_user_provider_unique" UNIQUE("user_id","provider"),
	CONSTRAINT "identities_provider_known" CHECK ("identities"."provider" in ('google', 'facebook')),
	CONSTRAINT "identities_subject_length" CHECK (char_length("identities"."subject") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"entry_point" text,
	"session_token_hash" text,
	"state" text NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"return_path" text,
	"connect_provider" text,
	"new_password_hash" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_states_token_hash_format" CHECK ("oauth_states"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "oauth_states_provider_known" CHECK ("oauth_states"."provider" in ('google', 'facebook')),
	CONSTRAINT "oauth_states_purpose_known" CHECK ("oauth_states"."purpose" in ('sign_in', 'reauthenticate', 'connect')),
	CONSTRAINT "oauth_states_entry_point_known" CHECK ("oauth_states"."entry_point" in ('login', 'register')),
	CONSTRAINT "oauth_states_return_path_length" CHECK (char_length("oauth_states"."return_path") <= 64),
	CONSTRAINT "oauth_states_connect_provider_known" CHECK ("oauth_states"."connect_provider" in ('google', 'facebook')),
	CONSTRAINT "oauth_states_connect_provider_shape" CHECK ("oauth_states"."connect_provider" is null or ("oauth_states"."purpose" = 'reauthenticate' and "oauth_states"."connect_provider" <> "oauth_states"."provider")),
	CONSTRAINT "oauth_states_new_password_hash_shape" CHECK ("oauth_states"."new_password_hash" is null or ("oauth_states"."purpose" = 'reauthenticate' and "oauth_states"."connect_provider" is null)),
	CONSTRAINT "oauth_states_purpose_shape" CHECK (("oauth_states"."purpose" = 'sign_in') = ("oauth_states"."entry_point" is not null) and ("oauth_states"."purpose" = 'sign_in') = ("oauth_states"."session_token_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "pending_identities" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"provider_email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"user_id" uuid,
	"entry_point" text NOT NULL,
	"return_path" text,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pending_identities_token_hash_format" CHECK ("pending_identities"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pending_identities_kind_known" CHECK ("pending_identities"."kind" in ('signup', 'link')),
	CONSTRAINT "pending_identities_provider_known" CHECK ("pending_identities"."provider" in ('google', 'facebook')),
	CONSTRAINT "pending_identities_subject_length" CHECK (char_length("pending_identities"."subject") between 1 and 255),
	CONSTRAINT "pending_identities_entry_point_known" CHECK ("pending_identities"."entry_point" in ('login', 'register')),
	CONSTRAINT "pending_identities_return_path_length" CHECK (char_length("pending_identities"."return_path") <= 64),
	CONSTRAINT "pending_identities_failed_attempts_range" CHECK ("pending_identities"."failed_attempts" between 0 and 5),
	CONSTRAINT "pending_identities_kind_shape" CHECK (("pending_identities"."kind" = 'link') = ("pending_identities"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_format" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"birth_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_verified_at" timestamp with time zone,
	"verification_reminded_at" timestamp with time zone,
	"data_review_required_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_email_length" CHECK (char_length("users"."email") between 3 and 254),
	CONSTRAINT "users_birth_date_min" CHECK ("users"."birth_date" >= date '1900-01-01'),
	CONSTRAINT "users_unverified_has_password" CHECK ("users"."email_verified_at" is not null or "users"."password_hash" is not null),
	CONSTRAINT "users_review_requires_verified" CHECK ("users"."data_review_required_at" is null or "users"."email_verified_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_session_token_hash_sessions_token_hash_fk" FOREIGN KEY ("session_token_hash") REFERENCES "public"."sessions"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_identities" ADD CONSTRAINT "pending_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_user_id_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_one_active_per_purpose" ON "consents" USING btree ("user_id","purpose") WHERE "consents"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_pending_unique" ON "email_outbox" USING btree ("kind","to_email") WHERE "email_outbox"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("next_attempt_at") WHERE "email_outbox"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "email_tokens_expires_at_idx" ON "email_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "identities_provider_email_normalized_idx" ON "identities" USING btree (lower(btrim("provider_email")));--> statement-breakpoint
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_identities_expires_at_idx" ON "pending_identities" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_identities_user_id_idx" ON "pending_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_unverified_created_at_idx" ON "users" USING btree ("created_at") WHERE "users"."email_verified_at" is null;