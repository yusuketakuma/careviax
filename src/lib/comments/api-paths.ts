import { encodePathSegment } from '@/lib/http/path-segment';

export function buildCommentApiPath(commentId: string) {
  return `/api/comments/${encodePathSegment(commentId)}`;
}
