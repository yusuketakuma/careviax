import { describe, expect, it } from 'vitest';
import { COMMENTS_API_PATH, buildCommentApiPath, buildCommentsApiPath } from './api-paths';

describe('buildCommentsApiPath', () => {
  it('builds the comments collection API path', () => {
    expect(COMMENTS_API_PATH).toBe('/api/comments');
    expect(buildCommentsApiPath()).toBe('/api/comments');
  });

  it('builds collection API paths with encoded entity query params', () => {
    const params = new URLSearchParams({
      entity_type: 'patient',
      entity_id: 'patient/1?x=y#frag',
    });

    expect(buildCommentsApiPath(params)).toBe(
      '/api/comments?entity_type=patient&entity_id=patient%2F1%3Fx%3Dy%23frag',
    );
  });
});

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
