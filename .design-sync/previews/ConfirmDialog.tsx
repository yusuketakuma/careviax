import { ConfirmDialog } from 'ph-os';

const noop = () => {};

export function Default() {
  return (
    <div style={{ position: 'relative', minHeight: 260, padding: 20 }}>
      <ConfirmDialog
        open
        onOpenChange={noop}
        onConfirm={noop}
        title="監査へ送信しますか"
        description="山田 太郎 様の処方（2026/06/18）を監査担当へ送信します。送信後は調剤内容を編集できません。"
        confirmLabel="送信する"
        cancelLabel="戻る"
      />
    </div>
  );
}

export function Destructive() {
  return (
    <div style={{ position: 'relative', minHeight: 260, padding: 20 }}>
      <ConfirmDialog
        open
        onOpenChange={noop}
        onConfirm={noop}
        variant="destructive"
        title="調剤記録を削除しますか"
        description="この操作は取り消せません。削除履歴は監査ログに記録されます。"
        confirmLabel="削除する"
        cancelLabel="キャンセル"
      />
    </div>
  );
}

export function RequiredConfirmText() {
  return (
    <div style={{ position: 'relative', minHeight: 320, padding: 20 }}>
      <ConfirmDialog
        open
        onOpenChange={noop}
        onConfirm={noop}
        variant="destructive"
        title="患者データを完全に削除"
        description="佐藤 ハナ 様の全データを削除します。要配慮個人情報を含むため、確認入力が必要です。"
        requiredConfirmText="削除"
        confirmLabel="完全に削除"
        cancelLabel="キャンセル"
      />
    </div>
  );
}
