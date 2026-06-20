import { describe, expect, it } from 'vitest';
import { summarizeBulkCompleteTaskFailures } from './bulk-completion-messages';

describe('bulk task completion messages', () => {
  it('summarizes distinct failure messages without exposing ids', () => {
    expect(
      summarizeBulkCompleteTaskFailures([
        { id: 'task_1', code: 'not_found', message: 'タスクが見つかりません' },
        { id: 'task_2', code: 'not_found', message: 'タスクが見つかりません' },
        {
          id: 'task_3',
          code: 'dedicated_completion_required',
          message: 'このタスクは専用画面で完了してください',
        },
        { id: 'task_4', code: 'conflict', message: '再読み込みしてください' },
        { id: 'task_5', code: 'patient_not_writable', message: '患者が見つかりません' },
      ]),
    ).toBe(
      '失敗理由: タスクが見つかりません / このタスクは専用画面で完了してください / 再読み込みしてください。ほか1件',
    );
  });
});
