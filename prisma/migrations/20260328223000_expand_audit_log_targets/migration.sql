-- Expand DB-side audit logging to core dispensing and set-audit workflow tables.

DROP TRIGGER IF EXISTS audit_log_dispense_result ON "DispenseResult";
CREATE TRIGGER audit_log_dispense_result
AFTER INSERT OR UPDATE OR DELETE ON "DispenseResult"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_dispense_audit ON "DispenseAudit";
CREATE TRIGGER audit_log_dispense_audit
AFTER INSERT OR UPDATE OR DELETE ON "DispenseAudit"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();

DROP TRIGGER IF EXISTS audit_log_set_audit ON "SetAudit";
CREATE TRIGGER audit_log_set_audit
AFTER INSERT OR UPDATE OR DELETE ON "SetAudit"
FOR EACH ROW EXECUTE FUNCTION ph_os_write_audit_log();
