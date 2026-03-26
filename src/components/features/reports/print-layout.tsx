// ─── Print Layout Component ───────────────────────────────────────────────────
// A4印刷用レイアウトコンポーネント。@media print で最適化。

const PRINT_STYLES = `
@media print {
  /* Hide non-print elements */
  nav,
  .sidebar,
  [data-print-hidden] {
    display: none !important;
  }

  /* A4 page setup */
  @page {
    size: A4;
    margin: 15mm 20mm;
  }

  body {
    font-size: 11pt;
    line-height: 1.6;
    color: #000;
    background: #fff;
  }

  /* Page break control */
  .print-layout {
    max-width: 100%;
  }

  /* Table styling for print */
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    border: 1px solid #999;
    padding: 4px 8px;
    font-size: 10pt;
  }
  th {
    background: #f0f0f0;
    font-weight: bold;
  }

  /* Badge/color overrides for print */
  .badge,
  [class*="bg-"] {
    background: transparent !important;
    border: 1px solid #999;
    color: #000 !important;
  }
}
`;

interface PrintLayoutProps {
  pharmacyName?: string;
  children: React.ReactNode;
}

export function PrintLayout({ pharmacyName, children }: PrintLayoutProps) {
  return (
    <div className="print-layout">
      {/* Inject print styles */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Print-only header */}
      <div className="hidden print:block print:mb-4">
        <div className="flex items-center justify-between border-b pb-2">
          <div className="text-lg font-bold">{pharmacyName ?? 'CareViaX薬局'}</div>
          <div className="text-sm text-gray-500">
            出力日: {new Date().toLocaleDateString('ja-JP')}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
