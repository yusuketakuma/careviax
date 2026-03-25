import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'パフォーマンス監視 — CareViaX',
};

const placeholderRoutes = [
  { route: '/api/patients', p50: '—', p95: '—', p99: '—', target: '< 500ms' },
  { route: '/api/visits', p50: '—', p95: '—', p99: '—', target: '< 500ms' },
  { route: '/api/prescriptions', p50: '—', p95: '—', p99: '—', target: '< 500ms' },
  { route: '/api/reports', p50: '—', p95: '—', p99: '—', target: '< 500ms' },
];

export default function PerformancePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          パフォーマンスモニタリング
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          API応答時間の監視。目標: P95 &lt; 500ms
        </p>
      </div>

      {/* Phase 3 placeholder banner */}
      <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm font-medium text-blue-800">
          CloudWatch連携はPhase 3で実装
        </p>
        <p className="mt-1 text-sm text-blue-700">
          現在はアプリログによるローカル計測のみ対応しています。Phase 3でAWS CloudWatch Metricsとの連携を実装します。
        </p>
      </div>

      {/* API応答時間テーブル */}
      <div className="rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">エンドポイント</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">P50</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">P95</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">P99</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">目標</th>
            </tr>
          </thead>
          <tbody>
            {placeholderRoutes.map((row, i) => (
              <tr key={row.route} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                <td className="px-4 py-3 font-mono text-xs text-foreground">{row.route}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{row.p50}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{row.p95}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{row.p99}</td>
                <td className="px-4 py-3 text-right text-xs text-blue-600">{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">CloudWatch連携後にリアルタイムデータが表示されます</p>
        </div>
      </div>
    </div>
  );
}
