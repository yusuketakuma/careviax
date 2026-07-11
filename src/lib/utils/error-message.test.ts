import { describe, expect, it } from 'vitest';

import { messageFromError, SafeClientMessageError } from './error-message';

describe('messageFromError', () => {
  it('uses fixed fallback copy instead of a raw Error message', () => {
    expect(
      messageFromError(new Error('患者 山田太郎 090-1234-5678 token=secret'), '保存に失敗しました'),
    ).toBe('保存に失敗しました');
  });

  it('uses the fallback for an Error with an empty message', () => {
    expect(messageFromError(new Error(''), 'fallback')).toBe('fallback');
  });

  it('uses the fallback for non-Error values', () => {
    expect(messageFromError('raw failure', 'fallback')).toBe('fallback');
    expect(messageFromError(null, 'fallback')).toBe('fallback');
  });

  it('permits only reviewed local recovery copy', () => {
    expect(
      messageFromError(SafeClientMessageError.fromReviewed('候補はすでに更新済みです'), 'fallback'),
    ).toBe('候補はすでに更新済みです');
  });
});
