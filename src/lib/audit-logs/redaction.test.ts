import { describe, expect, it } from 'vitest';
import { redactAuditLogChangesForResponse } from './redaction';

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
      reject_reason: '却下理由は監査ログ本体に保管されています',
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
});
