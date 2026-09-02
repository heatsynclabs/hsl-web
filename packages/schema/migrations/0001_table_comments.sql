-- drizzle-orm 0.45.2 cannot express COMMENT ON, so the table and column comments
-- live here instead of in src/tables.ts. Keep the two in step by hand.
--
-- This file also makes audit_log append only in the database, which
-- decisions/0008-single-admin-plus-audit-log.md requires.

COMMENT ON TABLE "user" IS 'The member. This is also the better-auth user row: there is no separate profile table to keep in step.';--> statement-breakpoint
COMMENT ON COLUMN "user"."member_level" IS 'Dues tier, imported from Rails as it stood because it carries a role meaning and a dollar meaning at once. 0 None, 1 Unable, 10 to 24 Volunteer, 25 to 49 Associate, 50 to 99 Basic, 100 to 999 Plus. Null on 27 imported rows.';--> statement-breakpoint
COMMENT ON COLUMN "user"."waiver" IS 'When the member signed the liability release. Null means they have not.';--> statement-breakpoint
COMMENT ON COLUMN "user"."orientation" IS 'When the member completed new member orientation. Being oriented is what opens the member directory to them.';--> statement-breakpoint
COMMENT ON COLUMN "user"."oriented_by_id" IS 'The member who ran that orientation.';--> statement-breakpoint
COMMENT ON COLUMN "user"."hidden" IS 'The member asked to be left out of the directory.';--> statement-breakpoint
COMMENT ON COLUMN "user"."email_visible" IS 'Whether the directory shows this member''s email address to other members.';--> statement-breakpoint
COMMENT ON COLUMN "user"."phone_visible" IS 'Whether the directory shows this member''s phone number to other members.';--> statement-breakpoint
COMMENT ON COLUMN "user"."card_access" IS 'Whether the member may drive the doors remotely. Rails derived this from holding a card with permission bit 1. Here an admin sets it.';--> statement-breakpoint
COMMENT ON COLUMN "user"."payment_method" IS 'How this member''s dues arrive, recorded for the accountant.';--> statement-breakpoint
COMMENT ON COLUMN "user"."payee" IS 'The name dues arrive under when it is not the member''s own.';--> statement-breakpoint
COMMENT ON COLUMN "user"."legacy_id" IS 'users.id in the Rails database. Null for members created after the import.';--> statement-breakpoint

COMMENT ON TABLE "session" IS 'better-auth sessions. One first-party cookie for all three apps.';--> statement-breakpoint
COMMENT ON TABLE "account" IS 'better-auth credentials. One row per member with provider_id credential holds the bcrypt hash.';--> statement-breakpoint
COMMENT ON COLUMN "account"."issuer" IS 'local:credential for an imported member. The 1.7 sign-in handler filters on issuer, account_id and provider_id together, and a wrong issuer refuses every sign in with nothing useful in the log.';--> statement-breakpoint
COMMENT ON COLUMN "account"."password" IS 'The bcrypt hash, copied verbatim from the Rails encrypted_password so nobody has to reset a password. See decisions/0004-keep-bcrypt.md.';--> statement-breakpoint
COMMENT ON TABLE "verification" IS 'better-auth one time tokens for email verification and password reset.';--> statement-breakpoint

COMMENT ON TABLE "cards" IS 'Physical RFID tokens. One row per card the door controller should hold.';--> statement-breakpoint
COMMENT ON COLUMN "cards"."id" IS 'The card slot. This is an EEPROM address on the door controller, not a surrogate key: slot n lives at byte 24 + n * 5. It is assigned once and never renumbered, because renumbering silently hands a member someone else''s door permission. The usable range is 0 to 199, since checkUser stops reading at 199. Production holds one card at slot 200, which addUser accepts and the reader never sees, so nothing here rejects it.';--> statement-breakpoint
COMMENT ON COLUMN "cards"."card_number" IS 'The tag as 8 uppercase hex characters, padded up from the 5 to 7 character legacy form the way Rails padded it before writing to the controller. The reader compares all 32 bits exactly.';--> statement-breakpoint
COMMENT ON COLUMN "cards"."permissions" IS 'The permission mask byte the controller stores beside the tag. 63 production cards carry 1 and one carries 255.';--> statement-breakpoint
COMMENT ON COLUMN "cards"."active" IS 'Whether the door service writes this card to the controller on the next reconcile.';--> statement-breakpoint

COMMENT ON TABLE "certifications" IS 'The tool list, ten rows, named by the slugs the interlocks ask about.';--> statement-breakpoint
COMMENT ON TABLE "user_certifications" IS 'Who holds which certification, who granted it and when.';--> statement-breakpoint
COMMENT ON COLUMN "user_certifications"."granted_by_id" IS 'The instructor or admin who granted it. Null where the imported row did not name one.';--> statement-breakpoint

COMMENT ON TABLE "payments" IS 'Recorded dues. Money arrives offline and an accountant enters it here.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."amount_cents" IS 'Whole cents, so no dues figure passes through a float.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."paid_on" IS 'The date the money arrived. The 60 day dues window is measured from the newest of these per member.';--> statement-breakpoint
COMMENT ON COLUMN "payments"."recorded_by_id" IS 'The accountant who entered the row. Null on imported rows.';--> statement-breakpoint

COMMENT ON TABLE "waivers" IS 'Signed liability releases, held as a pointer to the stored document rather than a copy of it.';--> statement-breakpoint
COMMENT ON COLUMN "waivers"."document_ref" IS 'Where the signed document itself is kept.';--> statement-breakpoint
COMMENT ON COLUMN "waivers"."cosigner" IS 'Who cosigned, for a member who could not sign for themself.';--> statement-breakpoint

COMMENT ON TABLE "audit_log" IS 'Append only record of every privileged change: who did what to whom and when. Nothing updates or deletes a row here, and the trigger below refuses both.';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."action" IS 'What was done, as a stable string the audit screen can group by.';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."target_id" IS 'The row the action was about. A member id, or a card slot written as text, depending on the action.';--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."detail" IS 'Whatever a reader needs a year later to understand the change.';--> statement-breakpoint

COMMENT ON TABLE "door_events" IS 'What the door did, and the last status the controller reported. The door service posts these; the API never speaks the wire protocol.';--> statement-breakpoint
COMMENT ON COLUMN "door_events"."kind" IS 'A command the API sent, an entry drained from the controller event log, or a status snapshot.';--> statement-breakpoint
COMMENT ON COLUMN "door_events"."detail" IS 'The payload as it came off the controller.';--> statement-breakpoint

CREATE FUNCTION audit_log_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append only. The row was left as it was. Record a new row describing the correction instead.';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_refuse_change();
