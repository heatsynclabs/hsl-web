-- The append-only trigger added in 0001 is FOR EACH ROW, and TRUNCATE does not
-- fire row triggers. Anyone able to reach the database could erase the whole
-- audit log in one statement, which is the record standing in for two-admin
-- approval under decisions/0008-single-admin-plus-audit-log.md.
--
-- TRUNCATE needs its own statement-level trigger. The same applies to
-- door_events, which is the record of what opened the building and when.

CREATE FUNCTION append_only_refuse_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append only and cannot be truncated. Nothing was removed.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_refuse_truncate();--> statement-breakpoint

CREATE TRIGGER door_events_append_only
  BEFORE UPDATE OR DELETE ON "door_events"
  FOR EACH ROW EXECUTE FUNCTION audit_log_refuse_change();--> statement-breakpoint

CREATE TRIGGER door_events_no_truncate
  BEFORE TRUNCATE ON "door_events"
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_refuse_truncate();
