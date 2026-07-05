import { describe, expect, it } from 'vitest';
import {
  minimizeFormularyChangeRequestAuditChanges,
  redactAuditLogChangesForResponse,
} from './redaction';

describe('redactAuditLogChangesForResponse', () => {
  it('redacts proposal reject_reason free text without mutating the stored log object', () => {
    const log = {
      id: 'audit_reject_1',
      action: 'visit_schedule_proposal_rejected',
      changes: {
        reject_reason: '東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
        other: 'kept',
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result).not.toBe(log);
    expect(result.changes).toMatchObject({
      reject_reason: '却下理由の自由記載は出力対象外です',
      reject_reason_redacted: true,
      other: 'kept',
    });
    expect(resultText).not.toContain('東京都港区2-2-2');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('アムロジピン');
    expect(resultText).not.toContain('処方詳細');
    expect(log.changes.reject_reason).toBe('東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細');
  });

  it('leaves proposal rejection logs without reject_reason unchanged', () => {
    const log = {
      id: 'audit_update_1',
      action: 'visit_schedule_proposal_rejected',
      changes: { status: 'rejected' },
    };

    expect(redactAuditLogChangesForResponse(log)).toBe(log);
  });

  it('leaves new proposal rejection metadata unchanged', () => {
    const log = {
      id: 'audit_reject_2',
      action: 'visit_schedule_proposal_rejected',
      changes: {
        reject_reason_recorded: true,
        reject_reason_length: 42,
        reject_reason_storage: 'VisitScheduleProposal.reject_reason',
        reject_reason_text_stored: false,
      },
    };

    expect(redactAuditLogChangesForResponse(log)).toBe(log);
  });

  it('minimizes export audit changes instead of returning arbitrary raw fields', () => {
    const log = {
      id: 'audit_export_1',
      action: 'export',
      changes: {
        format: 'zip',
        record_count: 2,
        filters: {
          patient: 'patient_1',
          status: 'active',
        },
        metadata: {
          job_id: 'job_1',
          patient_ids: ['patient_1', 'patient_2'],
          patient_count: 2,
          requested_count: 2,
          patient_selection_hash: 'hash-1',
          storageKey: 'bulk-exports/org_1/job_1/raw.zip',
          provider_raw_error: '患者A token=secret',
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result).not.toBe(log);
    expect(result.changes).toEqual({
      format: 'zip',
      record_count: 2,
      filters: {
        status: 'active',
      },
      metadata: {
        job_id: 'job_1',
        patient_count: 2,
        requested_count: 2,
        patient_selection_hash: 'hash-1',
      },
    });
    expect(resultText).not.toContain('patient_1');
    expect(resultText).not.toContain('patient_2');
    expect(resultText).not.toContain('storageKey');
    expect(resultText).not.toContain('bulk-exports');
    expect(resultText).not.toContain('患者A');
    expect(resultText).not.toContain('secret');
  });

  it('keeps only canonical care report PDF profile metadata from legacy export rows', () => {
    const log = {
      id: 'audit_care_report_pdf_1',
      action: 'export',
      target_type: 'care_report',
      changes: {
        format: 'pdf',
        record_count: 1,
        metadata: {
          surface: 'care_report_pdf',
          output_profile: 'external_submission_pdf',
          report_updated_at: '2026-03-28T09:00:00.000Z',
          patient_name: '山田太郎',
          phone: '090-1234-5678',
          medication_name: 'アムロジピン',
          storageKey: 'reports/org_1/raw.pdf',
          signed_url: 'https://signed.example/raw.pdf?token=secret',
          provider_raw_error: 'provider raw error patient 山田',
          content: '処方全文',
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result).not.toBe(log);
    expect(result.changes).toEqual({
      format: 'pdf',
      record_count: 1,
      filters: {},
      metadata: {
        surface: 'care_report_pdf',
        output_profile: 'external_submission_pdf',
        report_updated_at: '2026-03-28T09:00:00.000Z',
      },
    });
    expect(resultText).not.toContain('山田');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('アムロジピン');
    expect(resultText).not.toContain('raw.pdf');
    expect(resultText).not.toContain('signed.example');
    expect(resultText).not.toContain('token=secret');
    expect(resultText).not.toContain('provider raw error');
    expect(resultText).not.toContain('処方全文');
    expect(log.changes.metadata.patient_name).toBe('山田太郎');
  });

  it.each([
    ['tracing_report', 'tracing_report_pdf'],
    ['visit_record', 'visit_record_pdf'],
    ['conference_note', 'conference_note_pdf'],
  ])(
    'keeps only canonical %s PDF profile metadata from legacy export rows',
    (targetType, surface) => {
      const log = {
        id: `audit_${targetType}_pdf_1`,
        action: 'export',
        target_type: targetType,
        changes: {
          format: 'pdf',
          record_count: 1,
          metadata: {
            surface,
            output_profile: 'internal_pdf',
            report_updated_at: '2026-03-28T09:00:00.000Z',
            file_id: 'file patient 山田',
            signed_url: 'https://signed.example/raw.pdf?token=secret',
            provider_raw_error: 'provider raw error',
          },
        },
      };

      const result = redactAuditLogChangesForResponse(log);
      const resultText = JSON.stringify(result);

      expect(result.changes).toEqual({
        format: 'pdf',
        record_count: 1,
        filters: {},
        metadata: {
          surface,
          output_profile: 'internal_pdf',
        },
      });
      expect(resultText).not.toContain('report_updated_at');
      expect(resultText).not.toContain('山田');
      expect(resultText).not.toContain('signed.example');
      expect(resultText).not.toContain('token=secret');
      expect(resultText).not.toContain('provider raw error');
    },
  );

  it('drops hostile values even when legacy export rows use globally allowlisted metadata keys', () => {
    const log = {
      id: 'audit_export_hostile_values_1',
      action: 'export',
      target_type: 'medication_history',
      changes: {
        format: 'zip',
        record_count: 3,
        metadata: {
          job_id: 'job_1 token=secret',
          file_id: 'bulk-exports/org_1/raw.zip',
          source: 'https://signed.example/raw.zip?token=secret',
          file_purpose: '患者 山田太郎 090-1234-5678',
          export_format: 'provider raw error',
          patient_count: 3,
          requested_count: 3,
          patient_selection_hash: 'hash-1',
          failure_codes: ['network_timeout', 'provider raw error patient 山田'],
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result.changes).toEqual({
      format: 'zip',
      record_count: 3,
      filters: {},
      metadata: {
        patient_count: 3,
        requested_count: 3,
        patient_selection_hash: 'hash-1',
      },
    });
    expect(resultText).not.toContain('token=secret');
    expect(resultText).not.toContain('bulk-exports');
    expect(resultText).not.toContain('signed.example');
    expect(resultText).not.toContain('山田太郎');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('provider raw error');
  });

  it('drops non-pattern PHI inside allowlisted export metadata keys', () => {
    const log = {
      id: 'audit_export_allowlisted_phi_1',
      action: 'export',
      target_type: 'medication_history',
      changes: {
        format: 'zip',
        record_count: 3,
        metadata: {
          job_id: '山田太郎',
          file_id: '東京都千代田区1-1-1',
          status: 'アムロジピン',
          patient_count: 3,
          requested_count: 3,
          patient_selection_hash: 'hash-1',
          failure_codes: ['network_timeout', '山田太郎'],
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result.changes).toEqual({
      format: 'zip',
      record_count: 3,
      filters: {},
      metadata: {
        patient_count: 3,
        requested_count: 3,
        patient_selection_hash: 'hash-1',
      },
    });
    expect(resultText).not.toContain('山田太郎');
    expect(resultText).not.toContain('東京都千代田区');
    expect(resultText).not.toContain('アムロジピン');
  });

  it('drops ASCII PHI-like single tokens inside allowlisted export metadata keys', () => {
    const log = {
      id: 'audit_export_ascii_phi_1',
      action: 'export',
      target_type: 'medication_history',
      changes: {
        format: 'zip',
        record_count: 1,
        metadata: {
          status: 'Amlodipine',
          job_id: 'Taro',
          file_id: 'Tokyo',
          patient_count: 1,
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);

    expect(result.changes).toEqual({
      format: 'zip',
      record_count: 1,
      filters: {},
      metadata: {
        patient_count: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Amlodipine');
    expect(JSON.stringify(result)).not.toContain('Taro');
    expect(JSON.stringify(result)).not.toContain('Tokyo');
  });

  it('drops hostile file_download values inside allowlisted metadata keys', () => {
    const log = {
      id: 'audit_file_download_hostile_values_1',
      action: 'file_download',
      target_type: 'file_asset',
      changes: {
        format: 'file',
        record_count: 1,
        metadata: {
          file_id: 'file_1',
          file_purpose: '患者 山田太郎 03-1234-5678',
          mime_type: 'application/pdf',
          size_bytes: 1000,
          source: 'https://signed.example/raw.pdf?token=secret',
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result.changes).toEqual({
      format: 'file',
      record_count: 1,
      filters: {},
      metadata: {
        file_id: 'file_1',
        mime_type: 'application/pdf',
        size_bytes: 1000,
      },
    });
    expect(resultText).not.toContain('山田太郎');
    expect(resultText).not.toContain('03-1234-5678');
    expect(resultText).not.toContain('signed.example');
    expect(resultText).not.toContain('token=secret');
  });

  it('minimizes generic sensitive audit changes instead of returning raw nested strings', () => {
    const log = {
      id: 'audit_patient_update_1',
      action: 'update',
      target_type: 'patient',
      changes: {
        id: 'patient_1',
        status: 'active',
        address: '東京都港区2-2-2',
        phone: '090-1234-5678',
        note: '患者A アムロジピン 処方詳細',
        before: {
          memo: '旧メモ token=secret',
          nested_id: 'case_1',
        },
        attachments: ['https://signed.example/raw.pdf?token=secret'],
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result).not.toBe(log);
    expect(result.changes).toMatchObject({
      id: 'patient_1',
      status: 'active',
      address_present: true,
      address_length: log.changes.address.length,
      address_redacted: true,
      phone_present: true,
      phone_length: log.changes.phone.length,
      phone_redacted: true,
      note_present: true,
      note_length: log.changes.note.length,
      note_redacted: true,
      before: {
        memo_present: true,
        memo_length: log.changes.before.memo.length,
        memo_redacted: true,
        nested_id: 'case_1',
      },
      attachments_present: true,
      attachments_count: 1,
      attachments_redacted: true,
    });
    expect(resultText).not.toContain('東京都港区');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('アムロジピン');
    expect(resultText).not.toContain('token=secret');
    expect(resultText).not.toContain('signed.example');
  });

  it('minimizes formulary request free text without hiding structured evidence', () => {
    const log = {
      id: 'audit_formulary_1',
      action: 'pharmacy_drug_stock_change_requested',
      target_type: 'FormularyChangeRequest',
      changes: {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        action_type: 'adopt',
        reason: '患者A 090-1234-5678 の処方に合わせて採用',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: 'generic_1',
          adoption_note: '山田花子 090-1234-5678 アムロジピン',
        },
        current_snapshot: {
          id: 'stock_1',
          is_stocked: false,
          reorder_point: null,
          preferred_generic_id: null,
          adoption_note: '旧メモ 山田太郎',
        },
      },
    };

    const result = redactAuditLogChangesForResponse(log);
    const resultText = JSON.stringify(result);

    expect(result).not.toBe(log);
    expect(result.changes).toMatchObject({
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      action_type: 'adopt',
      reason_present: true,
      reason_length: log.changes.reason.length,
      reason_redacted: true,
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        preferred_generic_id: 'generic_1',
        adoption_note_present: true,
        adoption_note_length: log.changes.requested_payload.adoption_note.length,
        adoption_note_redacted: true,
      },
      current_snapshot: {
        id: 'stock_1',
        is_stocked: false,
        reorder_point: null,
        preferred_generic_id: null,
        adoption_note_present: true,
        adoption_note_length: log.changes.current_snapshot.adoption_note.length,
        adoption_note_redacted: true,
      },
    });
    expect(result.changes).not.toHaveProperty('reason');
    expect(result.changes.requested_payload).not.toHaveProperty('adoption_note');
    expect(result.changes.current_snapshot).not.toHaveProperty('adoption_note');
    expect(resultText).not.toContain('患者A');
    expect(resultText).not.toContain('090-1234-5678');
    expect(resultText).not.toContain('山田花子');
    expect(resultText).not.toContain('山田太郎');
    expect(log.changes.requested_payload.adoption_note).toBe('山田花子 090-1234-5678 アムロジピン');
  });

  it('leaves formulary request structured-only changes unchanged', () => {
    const log = {
      id: 'audit_formulary_2',
      action: 'pharmacy_drug_stock_change_requested',
      changes: {
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        action_type: 'adopt',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          preferred_generic_id: 'generic_1',
        },
      },
    };

    expect(redactAuditLogChangesForResponse(log)).toBe(log);
  });

  it('minimizes approved and rejected formulary decision free text', () => {
    for (const action of [
      'pharmacy_drug_stock_change_approved',
      'pharmacy_drug_stock_change_rejected',
    ]) {
      const decisionNote = `${action} 患者B 03-1234-5678`;
      const log = {
        id: `audit_${action}`,
        action,
        target_type: 'FormularyChangeRequest',
        changes: {
          request_id: 'request_1',
          site_id: 'site_1',
          drug_master_id: 'drug_1',
          requested_payload: {
            is_stocked: true,
            reorder_point: 10,
            adoption_note: '佐藤一郎 03-1234-5678',
          },
          decision_note: decisionNote,
          applied_stock_id: action.endsWith('_approved') ? 'stock_1' : null,
        },
      };

      const result = redactAuditLogChangesForResponse(log);
      const resultText = JSON.stringify(result);

      expect(result).not.toBe(log);
      expect(result.changes).toMatchObject({
        request_id: 'request_1',
        site_id: 'site_1',
        drug_master_id: 'drug_1',
        requested_payload: {
          is_stocked: true,
          reorder_point: 10,
          adoption_note_present: true,
          adoption_note_length: log.changes.requested_payload.adoption_note.length,
          adoption_note_redacted: true,
        },
        decision_note_present: true,
        decision_note_length: decisionNote.length,
        decision_note_redacted: true,
      });
      expect(result.changes).not.toHaveProperty('decision_note');
      expect(result.changes.requested_payload).not.toHaveProperty('adoption_note');
      expect(resultText).not.toContain('患者B');
      expect(resultText).not.toContain('03-1234-5678');
      expect(resultText).not.toContain('佐藤一郎');
    }
  });

  it('minimizes formulary audit changes before persistence', () => {
    const changes = {
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      reason: '患者C 080-9999-0000',
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        adoption_note: '高橋二郎 080-9999-0000',
      },
      current_snapshot: {
        id: 'stock_1',
        adoption_note: null,
      },
    };

    const result = minimizeFormularyChangeRequestAuditChanges(changes);
    const resultText = JSON.stringify(result);

    expect(result).toMatchObject({
      site_id: 'site_1',
      drug_master_id: 'drug_1',
      reason_present: true,
      reason_length: changes.reason.length,
      reason_redacted: true,
      requested_payload: {
        is_stocked: true,
        reorder_point: 10,
        adoption_note_present: true,
        adoption_note_length: changes.requested_payload.adoption_note.length,
        adoption_note_redacted: true,
      },
      current_snapshot: {
        id: 'stock_1',
        adoption_note_present: false,
        adoption_note_length: 0,
        adoption_note_redacted: true,
      },
    });
    expect(result).not.toHaveProperty('reason');
    expect(result?.requested_payload).not.toHaveProperty('adoption_note');
    expect(result?.current_snapshot).not.toHaveProperty('adoption_note');
    expect(resultText).not.toContain('患者C');
    expect(resultText).not.toContain('080-9999-0000');
    expect(resultText).not.toContain('高橋二郎');
    expect(changes.requested_payload.adoption_note).toBe('高橋二郎 080-9999-0000');
  });
});
