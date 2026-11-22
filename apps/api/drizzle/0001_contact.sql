CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"privacy_policy_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "contact_messages_name_length" CHECK (char_length("contact_messages"."name") between 1 and 100),
	CONSTRAINT "contact_messages_name_single_line" CHECK ("contact_messages"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "contact_messages_email_normalized" CHECK ("contact_messages"."email" = lower(btrim("contact_messages"."email"))),
	CONSTRAINT "contact_messages_email_length" CHECK (char_length("contact_messages"."email") between 3 and 254),
	CONSTRAINT "contact_messages_phone_format" CHECK ("contact_messages"."phone" is null or (char_length("contact_messages"."phone") between 7 and 30 and "contact_messages"."phone" ~ '^\+?[0-9 ().-]+$')),
	CONSTRAINT "contact_messages_subject_length" CHECK (char_length("contact_messages"."subject") between 3 and 120),
	CONSTRAINT "contact_messages_subject_single_line" CHECK ("contact_messages"."subject" !~ '[[:cntrl:]]'),
	CONSTRAINT "contact_messages_message_length" CHECK (char_length("contact_messages"."message") between 10 and 3000),
	CONSTRAINT "contact_messages_policy_version_length" CHECK (char_length("contact_messages"."privacy_policy_version") between 1 and 64),
	CONSTRAINT "contact_messages_notified_after_created" CHECK ("contact_messages"."notified_at" is null or "contact_messages"."notified_at" >= "contact_messages"."created_at")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_known";--> statement-breakpoint
DROP INDEX "email_outbox_pending_unique";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "contact_message_id" uuid;--> statement-breakpoint
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_contact_message_id_contact_messages_id_fk" FOREIGN KEY ("contact_message_id") REFERENCES "public"."contact_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_contact_pending_unique" ON "email_outbox" USING btree ("contact_message_id","kind") WHERE "email_outbox"."failed_at" is null and "email_outbox"."contact_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_pending_unique" ON "email_outbox" USING btree ("kind","to_email") WHERE "email_outbox"."failed_at" is null and "email_outbox"."contact_message_id" is null;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_contact_ref" CHECK (("email_outbox"."kind" in ('contact_message', 'contact_ack')) = ("email_outbox"."contact_message_id" is not null));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_known" CHECK ("email_outbox"."kind" in ('verify_email', 'verify_reminder', 'reset_password', 'signup_notice', 'password_changed', 'contact_message', 'contact_ack'));