import { z } from 'zod';

function isSafeInternalFileDownloadHref(value: string) {
  const match = /^\/api\/files\/([^/?#]+)\/download$/.exec(value);
  if (!match?.[1]) return false;
  try {
    const decodedId = decodeURIComponent(match[1]);
    return decodedId.trim().length > 0 && decodedId !== '.' && decodedId !== '..';
  } catch {
    return false;
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const careReportPdfReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (value) => isSafeInternalFileDownloadHref(value) || isHttpUrl(value),
    '報告書PDF参照が不正です',
  );
