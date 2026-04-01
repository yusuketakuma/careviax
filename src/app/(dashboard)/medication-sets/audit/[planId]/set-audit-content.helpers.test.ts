import { describe, expect, it } from 'vitest';
import { buildSetAuditSubmission } from './set-audit-content.helpers';

describe('buildSetAuditSubmission', () => {
  it('returns pending while unreviewed slots remain', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '1-noon'],
      localApproval: new Map([['1-morning', true]]),
      rejectReasonsByDay: new Map(),
    });

    expect(result).toEqual({
      kind: 'pending',
      message: '未鑑査のスロットがあります',
    });
  });

  it('builds an approved payload when every slot is approved', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '1-noon'],
      localApproval: new Map([
        ['1-morning', true],
        ['1-noon', true],
      ]),
      rejectReasonsByDay: new Map(),
    });

    expect(result).toEqual({
      kind: 'ready',
      payload: {
        result: 'approved',
        approved_scope: {
          '1-morning': true,
          '1-noon': true,
        },
      },
    });
  });

  it('builds a partial approval payload with approved scope and reject reason', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '1-noon', '2-evening'],
      localApproval: new Map([
        ['1-morning', true],
        ['1-noon', false],
        ['2-evening', true],
      ]),
      rejectReasonsByDay: new Map([[1, '数量誤り']]),
    });

    expect(result).toEqual({
      kind: 'ready',
      payload: {
        result: 'partial_approved',
        approved_scope: {
          '1-morning': true,
          '2-evening': true,
        },
        reject_reason: '数量誤り',
      },
    });
  });

  it('builds a rejected payload and falls back to the default reason', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '2-evening'],
      localApproval: new Map([
        ['1-morning', false],
        ['2-evening', false],
      ]),
      rejectReasonsByDay: new Map(),
    });

    expect(result).toEqual({
      kind: 'ready',
      payload: {
        result: 'rejected',
        reject_reason: '差戻し理由未記入',
      },
    });
  });
});
