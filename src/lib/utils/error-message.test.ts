import { describe, expect, it } from 'vitest';

import { messageFromError } from './error-message';

describe('messageFromError', () => {
  it('uses a non-empty Error message', () => {
    expect(messageFromError(new Error('保存に失敗しました'), 'fallback')).toBe(
      '保存に失敗しました',
    );
  });

  it('uses the fallback for an Error with an empty message', () => {
    expect(messageFromError(new Error(''), 'fallback')).toBe('fallback');
  });

  it('uses the fallback for non-Error values', () => {
    expect(messageFromError('raw failure', 'fallback')).toBe('fallback');
    expect(messageFromError(null, 'fallback')).toBe('fallback');
  });
});
