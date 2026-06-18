import { ErrorState } from 'ph-os';

export function ServerError() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <ErrorState
        variant="server"
        detail="リクエストID: req_8f21c9 / 2026-06-18 10:42"
        action={{ label: '再読み込み', onClick: () => {} }}
        secondaryAction={{ label: 'ダッシュボードへ戻る', variant: 'outline', onClick: () => {} }}
      />
    </div>
  );
}

export function NotFound() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <ErrorState
        variant="not-found"
        action={{ label: '患者一覧へ戻る', variant: 'outline', onClick: () => {} }}
      />
    </div>
  );
}

export function Network() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <ErrorState
        variant="network"
        detail="オフライン中は服薬指導記録の下書きのみ編集できます。"
        action={{ label: '再接続を試す', onClick: () => {} }}
      />
    </div>
  );
}

export function Forbidden() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <ErrorState
        variant="forbidden"
        action={{ label: '権限を申請する', variant: 'secondary', onClick: () => {} }}
      />
    </div>
  );
}

export function Unauthorized() {
  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <ErrorState variant="unauthorized" action={{ label: 'ログイン画面へ', onClick: () => {} }} />
    </div>
  );
}
