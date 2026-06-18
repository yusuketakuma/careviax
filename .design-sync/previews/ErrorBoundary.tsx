import { ErrorBoundary } from 'ph-os';

function Throws(): React.ReactNode {
  throw new Error('処方データの取得に失敗しました');
}

export function DefaultFallback() {
  return (
    <div style={{ padding: 20, minWidth: 480 }}>
      <ErrorBoundary>
        <Throws />
      </ErrorBoundary>
    </div>
  );
}

export function CustomFallback() {
  return (
    <div style={{ padding: 20, minWidth: 480 }}>
      <ErrorBoundary
        fallback={
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
              padding: 32,
              textAlign: 'center',
            }}
          >
            <strong style={{ color: 'var(--destructive)' }}>訪問スケジュールを表示できません</strong>
            <span style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>
              通信状態を確認して再読み込みしてください。
            </span>
          </div>
        }
      >
        <Throws />
      </ErrorBoundary>
    </div>
  );
}
