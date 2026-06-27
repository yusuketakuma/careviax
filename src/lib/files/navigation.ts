import { encodePathSegment } from '@/lib/http/path-segment';

export function buildFileDownloadHref(fileId: string) {
  return `/api/files/${encodePathSegment(fileId)}/download`;
}
