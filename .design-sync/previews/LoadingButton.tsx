import { LoadingButton } from 'ph-os';

export function Idle() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <LoadingButton>報告書を提出</LoadingButton>
      <LoadingButton variant="outline">下書き保存</LoadingButton>
    </div>
  );
}

export function Loading() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <LoadingButton loading loadingLabel="提出中...">報告書を提出</LoadingButton>
      <LoadingButton loading loadingLabel="受付中..." variant="secondary">訪問を受付</LoadingButton>
    </div>
  );
}

export function VariantsLoading() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <LoadingButton loading loadingLabel="保存中...">保存する</LoadingButton>
      <LoadingButton loading loadingLabel="送信中..." variant="outline">医師へ送信</LoadingButton>
      <LoadingButton loading loadingLabel="削除中..." variant="destructive">記録を削除</LoadingButton>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <LoadingButton disabled>提出（権限なし）</LoadingButton>
    </div>
  );
}
