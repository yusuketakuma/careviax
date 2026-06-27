import { describe, expect, it } from 'vitest';
import { buildCommentApiPath } from './api-paths';

describe('buildCommentApiPath', () => {
  it('builds comment detail API paths for normal ids', () => {
    expect(buildCommentApiPath('comment_1')).toBe('/api/comments/comment_1');
  });

  it('encodes only the comment id path segment', () => {
    const commentId = 'comment/1?tab=x#frag';

    expect(buildCommentApiPath(commentId)).toBe(`/api/comments/${encodeURIComponent(commentId)}`);
  });

  it.each(['.', '..'])('rejects exact dot-segment comment id %s', (commentId) => {
    expect(() => buildCommentApiPath(commentId)).toThrow(RangeError);
  });
});
