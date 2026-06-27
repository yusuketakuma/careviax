import { describe, expect, it } from 'vitest';
import { buildFileDownloadHref } from './navigation';

describe('buildFileDownloadHref', () => {
  it('builds the file download route for normal ids', () => {
    expect(buildFileDownloadHref('file_1')).toBe('/api/files/file_1/download');
  });

  it('encodes hostile file ids as one path segment', () => {
    const fileId = '../file with space?x=1#frag';

    expect(buildFileDownloadHref(fileId)).toBe(`/api/files/${encodeURIComponent(fileId)}/download`);
  });

  it.each(['.', '..'])('rejects exact dot-segment file id %s', (fileId) => {
    expect(() => buildFileDownloadHref(fileId)).toThrow(RangeError);
  });
});
