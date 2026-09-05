-- The row trigger added in 0001 is attached to audit_log and, since 0002, to
-- door_events as well, and its message names audit_log either way. Somebody
-- trying to remove a door status row with a poisoned clock, which is the one
-- reason anybody reaches for a delete here, was told the wrong table was
-- refusing them. The truncate function beside it already reads TG_TABLE_NAME.

CREATE OR REPLACE FUNCTION audit_log_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append only. The row was left as it was. Record a new row describing the correction instead.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
