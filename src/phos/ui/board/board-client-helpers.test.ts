import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import { PhosApiError, PhosOfflineQueuedError } from '@/phos/api/types';
import {
  actionErrorMessage,
  dateKey,
  errorToast,
  sessionHasCapacityRole,
} from './board-client-helpers';

describe('sessionHasCapacityRole', () => {
  it.each([UserRole.ADMIN, UserRole.MANAGER])(
    'accepts the direct capacity role %s without groups',
    (role) => {
      expect(sessionHasCapacityRole(role, undefined)).toBe(true);
    },
  );

  it.each([
    [[' admin '], UserRole.PHARMACIST],
    [['manager'], UserRole.PHARMACY_CLERK],
    [[null, 42, ' MANAGER '], undefined],
  ])('accepts normalized capacity groups %#', (groups, role) => {
    expect(sessionHasCapacityRole(role, groups)).toBe(true);
  });

  it.each([
    [UserRole.PHARMACIST, undefined],
    [UserRole.PHARMACY_CLERK, null],
    [UserRole.DISPENSE_ASSISTANT, 'ADMIN'],
    [undefined, { group: 'MANAGER' }],
    [undefined, ['PHARMACIST', 'PHARMACY_CLERK']],
    ['admin', []],
    [null, [null, 42]],
  ])('rejects denied roles and invalid group claims %#', (role, groups) => {
    expect(sessionHasCapacityRole(role, groups)).toBe(false);
  });
});

describe('deterministic board client helpers', () => {
  it('formats a calendar date without time or randomness', () => {
    expect(dateKey(new Date(2026, 6, 22, 23, 59, 59))).toBe('2026-07-22');
  });

  it.each([
    [
      new PhosOfflineQueuedError({ queue_id: 'queue_1' }),
      'オフラインキューに保存しました。オンライン復帰後に同期します。',
    ],
    [
      new PhosApiError(422, {
        request_id: 'request_1',
        error_code: 'ACTION_GUARD_FAILED',
        message_key: 'error.action_guard_failed',
      }),
      '必要な情報が不足しています。カード詳細で不足内容を確認してください。',
    ],
    [
      new PhosApiError(409, {
        request_id: 'request_2',
        error_code: 'STALE_VERSION',
        message_key: 'error.stale_version',
      }),
      '他の端末で更新されています。カードを再読み込みしてください。',
    ],
    [new Error('network unavailable'), '通信できません。再試行してください。'],
  ])('maps representative action errors to stable user messages %#', (error, expected) => {
    expect(actionErrorMessage(error)).toBe(expected);
  });

  it('builds the stable error toast envelope', () => {
    expect(errorToast('再試行してください')).toEqual({
      tone: 'ERROR',
      message_key: 'toast.action.error',
      params: { message: '再試行してください' },
    });
  });
});
