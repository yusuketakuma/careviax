import { describe, expect, it } from 'vitest';
import {
  EXPECTED_AUDIT_TRIGGER_CONTRACTS,
  validateAuditTriggerContracts,
} from './audit-trigger-contract';
import type { AuditTriggerCatalogRow } from './audit-trigger-contract';

function makeValidRows(): AuditTriggerCatalogRow[] {
  return EXPECTED_AUDIT_TRIGGER_CONTRACTS.map((contract) => ({
    tgname: contract.name,
    table_name: contract.tableName,
    function_name: 'functionName' in contract ? contract.functionName : 'ph_os_write_audit_log',
    tgenabled: 'O',
    is_row_trigger: true,
    is_before_trigger: false,
    fires_on_insert: true,
    fires_on_update: true,
    fires_on_delete: true,
    fires_on_truncate: false,
  }));
}

describe('validateAuditTriggerContracts', () => {
  it('accepts the expected PH-OS audit trigger contract', () => {
    expect(validateAuditTriggerContracts(makeValidRows())).toEqual([]);
  });

  it('requires ConsentRecord to use the redacted audit trigger function', () => {
    const rows = makeValidRows().map((row) =>
      row.tgname === 'audit_log_consent_record'
        ? { ...row, function_name: 'ph_os_write_audit_log' }
        : row,
    );

    expect(validateAuditTriggerContracts(rows)).toContainEqual({
      triggerName: 'audit_log_consent_record',
      reason: 'function=ph_os_write_audit_log, expected=ph_os_write_consent_record_audit_log',
    });
  });

  it('rejects missing audit triggers', () => {
    const rows = makeValidRows().filter((row) => row.tgname !== 'audit_log_task');

    expect(validateAuditTriggerContracts(rows)).toContainEqual({
      triggerName: 'audit_log_task',
      reason: 'missing',
    });
  });

  it('rejects a trigger attached to the wrong table', () => {
    const rows = makeValidRows().map((row) =>
      row.tgname === 'audit_log_task' ? { ...row, table_name: 'Patient' } : row,
    );

    expect(validateAuditTriggerContracts(rows)).toContainEqual({
      triggerName: 'audit_log_task',
      reason: 'table=Patient, expected=Task',
    });
  });

  it('rejects disabled, statement-level, BEFORE, and wrong-function triggers', () => {
    const rows = makeValidRows().map((row) =>
      row.tgname === 'audit_log_task'
        ? {
            ...row,
            function_name: 'unsafe_audit_function',
            tgenabled: 'D',
            is_row_trigger: false,
            is_before_trigger: true,
          }
        : row,
    );

    expect(validateAuditTriggerContracts(rows)).toEqual(
      expect.arrayContaining([
        {
          triggerName: 'audit_log_task',
          reason: 'function=unsafe_audit_function, expected=ph_os_write_audit_log',
        },
        { triggerName: 'audit_log_task', reason: 'enabled=D' },
        { triggerName: 'audit_log_task', reason: 'not row-level' },
        { triggerName: 'audit_log_task', reason: 'not AFTER trigger' },
      ]),
    );
  });

  it('rejects missing DML events and unexpected TRUNCATE triggers', () => {
    const rows = makeValidRows().map((row) =>
      row.tgname === 'audit_log_task'
        ? {
            ...row,
            fires_on_update: false,
            fires_on_delete: false,
            fires_on_truncate: true,
          }
        : row,
    );

    expect(validateAuditTriggerContracts(rows)).toEqual(
      expect.arrayContaining([
        {
          triggerName: 'audit_log_task',
          reason: 'events insert=true, update=false, delete=false',
        },
        { triggerName: 'audit_log_task', reason: 'unexpected TRUNCATE event' },
      ]),
    );
  });
});
