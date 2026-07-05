const unsafePdfFilenamePattern =
  /(patient|token|secret|signed|storage|object|provider|raw|error|https?|cookie|header|content-disposition|[0-9]{2,4}-[0-9]{2,4}-[0-9]{3,4})/i;

function sanitizePdfFilename(fileName: string) {
  const basename = fileName.split(/[\\/]/).pop() ?? '';
  const withoutControls = basename.replace(/[\r\n\t\0]/g, '').trim();
  const asciiOnly = withoutControls
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  const withPdfExtension = asciiOnly.toLowerCase().endsWith('.pdf')
    ? asciiOnly
    : `${asciiOnly}.pdf`;
  if (!asciiOnly || unsafePdfFilenamePattern.test(withPdfExtension)) return 'document.pdf';
  return withPdfExtension;
}

export function pdfResponse(buffer: Buffer, fileName: string) {
  const safeFileName = sanitizePdfFilename(fileName);
  const encodedFileName = encodeURIComponent(safeFileName);

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeFileName}"; filename*=UTF-8''${encodedFileName}`,
      'Cache-Control': 'no-store',
    },
  });
}
