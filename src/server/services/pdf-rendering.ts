import fs from 'node:fs';
import path from 'node:path';
import { Font, type DocumentProps, renderToBuffer } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { prisma } from '@/lib/db/client';

export type PdfRenderResult = {
  buffer: Buffer;
  fileName: string;
};

let fontRegistered = false;

export function formatPdfDate(value?: Date | string | null, includeTime = false) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const datePart = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  if (!includeTime) return datePart;

  return `${datePart} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function sanitizePdfFileName(value: string) {
  return (
    value
      .trim()
      .replaceAll(/[^A-Za-z0-9._-]/g, '_')
      .replaceAll(/_+/g, '_')
      .replaceAll(/^_+|_+$/g, '') || 'document'
  );
}

export function inferPdfPharmacyName(orgName?: string | null, siteName?: string | null) {
  return siteName?.trim() || orgName?.trim() || 'PH-OS薬局';
}

export function ensurePdfFontRegistered() {
  if (fontRegistered) return;

  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.otf');
  if (!fs.existsSync(fontPath)) {
    throw new Error('PDF 用フォントを初期化できませんでした');
  }

  Font.register({
    family: 'NotoSansJP',
    src: fontPath,
  });
  fontRegistered = true;
}

export async function renderPdf(
  document: ReactElement,
  fileName: string,
): Promise<PdfRenderResult> {
  ensurePdfFontRegistered();
  const buffer = await renderToBuffer(document as ReactElement<DocumentProps>);
  return { buffer, fileName };
}

export async function getPdfBranding(orgId: string) {
  const [org, site] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    }),
    prisma.pharmacySite.findFirst({
      where: { org_id: orgId },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    }),
  ]);

  return {
    pharmacyName: inferPdfPharmacyName(org?.name, site?.name),
  };
}
