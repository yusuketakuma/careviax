interface PrintLayoutProps {
  pharmacyName?: string;
  children: React.ReactNode;
}

export function PrintLayout({ pharmacyName, children }: PrintLayoutProps) {
  return (
    <div className="print-layout-root">
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
