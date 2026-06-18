import { Alert, AlertTitle, AlertDescription } from 'ph-os';

export function Info() {
  return (
    <div style={{ padding: 20, maxWidth: 460 }}>
      <Alert>
        <AlertTitle>処方箋を受け付けました</AlertTitle>
        <AlertDescription>
          調剤待ちキューに追加しました。監査が完了すると担当薬剤師へ通知されます。
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function Destructive() {
  return (
    <div style={{ padding: 20, maxWidth: 460 }}>
      <Alert variant="destructive">
        <AlertTitle>相互作用の警告</AlertTitle>
        <AlertDescription>
          併用禁忌の組み合わせ（ワルファリン × NSAIDs）が検出されました。処方医へ疑義照会してください。
        </AlertDescription>
      </Alert>
    </div>
  );
}
