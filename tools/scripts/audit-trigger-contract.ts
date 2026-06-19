export const EXPECTED_AUDIT_TRIGGER_CONTRACTS = [
  { name: 'audit_log_patient', tableName: 'Patient' },
  { name: 'audit_log_patient_insurance', tableName: 'PatientInsurance' },
  { name: 'audit_log_care_case', tableName: 'CareCase' },
  {
    name: 'audit_log_consent_record',
    tableName: 'ConsentRecord',
    functionName: 'ph_os_write_consent_record_audit_log',
  },
  { name: 'audit_log_management_plan', tableName: 'ManagementPlan' },
  { name: 'audit_log_visit_schedule', tableName: 'VisitSchedule' },
  { name: 'audit_log_visit_preparation', tableName: 'VisitPreparation' },
  { name: 'audit_log_visit_record', tableName: 'VisitRecord' },
  { name: 'audit_log_communication_request', tableName: 'CommunicationRequest' },
  { name: 'audit_log_care_report', tableName: 'CareReport' },
  { name: 'audit_log_external_access_grant', tableName: 'ExternalAccessGrant' },
  { name: 'audit_log_workflow_exception', tableName: 'WorkflowException' },
  { name: 'audit_log_task', tableName: 'Task' },
  { name: 'audit_log_dispense_result', tableName: 'DispenseResult' },
  { name: 'audit_log_dispense_audit', tableName: 'DispenseAudit' },
  { name: 'audit_log_set_audit', tableName: 'SetAudit' },
  { name: 'audit_log_pca_pump', tableName: 'PcaPump' },
  { name: 'audit_log_pca_pump_rental', tableName: 'PcaPumpRental' },
  { name: 'audit_log_pca_pump_rental_accessory', tableName: 'PcaPumpRentalAccessory' },
  { name: 'audit_log_pca_pump_maintenance_event', tableName: 'PcaPumpMaintenanceEvent' },
  { name: 'audit_log_visit_vehicle_resource', tableName: 'VisitVehicleResource' },
  {
    name: 'audit_log_patient_share_consent',
    tableName: 'PatientShareConsent',
    functionName: 'ph_os_write_patient_share_consent_audit_log',
  },
] as const;

export type ExpectedAuditTriggerContract = (typeof EXPECTED_AUDIT_TRIGGER_CONTRACTS)[number];

export type AuditTriggerCatalogRow = {
  tgname: string;
  table_name: string;
  function_name: string;
  tgenabled: string;
  is_row_trigger: boolean;
  is_before_trigger: boolean;
  fires_on_insert: boolean;
  fires_on_update: boolean;
  fires_on_delete: boolean;
  fires_on_truncate: boolean;
};

export type AuditTriggerContractIssue = {
  triggerName: string;
  reason: string;
};

export const EXPECTED_AUDIT_TRIGGER_NAMES = EXPECTED_AUDIT_TRIGGER_CONTRACTS.map(
  (contract) => contract.name,
);

export const AUDIT_TRIGGER_CATALOG_SQL = `
  SELECT
    pg_trigger.tgname AS tgname,
    table_class.relname AS table_name,
    pg_proc.proname AS function_name,
    pg_trigger.tgenabled AS tgenabled,
    (pg_trigger.tgtype & 1) <> 0 AS is_row_trigger,
    (pg_trigger.tgtype & 2) <> 0 AS is_before_trigger,
    (pg_trigger.tgtype & 4) <> 0 AS fires_on_insert,
    (pg_trigger.tgtype & 8) <> 0 AS fires_on_delete,
    (pg_trigger.tgtype & 16) <> 0 AS fires_on_update,
    (pg_trigger.tgtype & 32) <> 0 AS fires_on_truncate
  FROM pg_trigger
  JOIN pg_class AS table_class ON table_class.oid = pg_trigger.tgrelid
  JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
  JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
  WHERE NOT pg_trigger.tgisinternal
    AND table_namespace.nspname = 'public'
    AND pg_trigger.tgname = ANY($1::text[])
  ORDER BY pg_trigger.tgname
`;

export function describeAuditTriggerIssue(issue: AuditTriggerContractIssue) {
  return `${issue.triggerName}:${issue.reason}`;
}

export function validateAuditTriggerContracts(
  rows: AuditTriggerCatalogRow[],
): AuditTriggerContractIssue[] {
  const rowByName = new Map(rows.map((row) => [row.tgname, row]));
  const issues: AuditTriggerContractIssue[] = [];

  for (const expected of EXPECTED_AUDIT_TRIGGER_CONTRACTS) {
    const row = rowByName.get(expected.name);
    if (!row) {
      issues.push({ triggerName: expected.name, reason: 'missing' });
      continue;
    }

    if (row.table_name !== expected.tableName) {
      issues.push({
        triggerName: expected.name,
        reason: `table=${row.table_name}, expected=${expected.tableName}`,
      });
    }
    const expectedFunctionName =
      'functionName' in expected ? expected.functionName : 'ph_os_write_audit_log';
    if (row.function_name !== expectedFunctionName) {
      issues.push({
        triggerName: expected.name,
        reason: `function=${row.function_name}, expected=${expectedFunctionName}`,
      });
    }
    if (row.tgenabled !== 'O') {
      issues.push({ triggerName: expected.name, reason: `enabled=${row.tgenabled}` });
    }
    if (!row.is_row_trigger) {
      issues.push({ triggerName: expected.name, reason: 'not row-level' });
    }
    if (row.is_before_trigger) {
      issues.push({ triggerName: expected.name, reason: 'not AFTER trigger' });
    }
    if (!row.fires_on_insert || !row.fires_on_update || !row.fires_on_delete) {
      issues.push({
        triggerName: expected.name,
        reason: `events insert=${row.fires_on_insert}, update=${row.fires_on_update}, delete=${row.fires_on_delete}`,
      });
    }
    if (row.fires_on_truncate) {
      issues.push({ triggerName: expected.name, reason: 'unexpected TRUNCATE event' });
    }
  }

  return issues;
}
