import { encodePathSegment } from '@/lib/http/path-segment';

export const COMMENTS_API_PATH = '/api/comments';

export function buildCommentsApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${COMMENTS_API_PATH}?${query}` : COMMENTS_API_PATH;
}

export function buildCommentApiPath(commentId: string) {
  return `${COMMENTS_API_PATH}/${encodePathSegment(commentId)}`;
}
