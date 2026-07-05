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

  it('leaves other audit actions unchanged', () => {
    const log = {
      id: 'audit_export_1',
      action: 'export',
      changes: {
        reject_reason: '自由記載',
      },
    };

    expect(redactAuditLogChangesForResponse(log)).toBe(log);
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
