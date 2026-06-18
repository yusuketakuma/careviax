import { ActionRail, Button } from 'ph-os';

export function EndAligned() {
  return (
    <div style={{ padding: 20, maxWidth: 520 }}>
      <ActionRail>
        <Button variant="outline">キャンセル</Button>
        <Button variant="default">保険証を保存</Button>
      </ActionRail>
    </div>
  );
}

export function StartAligned() {
  return (
    <div style={{ padding: 20, maxWidth: 520 }}>
      <ActionRail align="start">
        <Button variant="secondary">疑義照会を追加</Button>
        <Button variant="outline">服薬指導記録</Button>
      </ActionRail>
    </div>
  );
}

export function SpaceBetween() {
  return (
    <div style={{ padding: 20, maxWidth: 520 }}>
      <ActionRail align="between">
        <Button variant="ghost">前の患者へ</Button>
        <Button variant="default">訪問記録を確定</Button>
      </ActionRail>
    </div>
  );
}

export function ManyActions() {
  return (
    <div style={{ padding: 20, maxWidth: 520 }}>
      <ActionRail>
        <Button variant="ghost" size="sm">
          下書き保存
        </Button>
        <Button variant="outline" size="sm">
          PDF出力
        </Button>
        <Button variant="outline" size="sm">
          医師へ送信
        </Button>
        <Button variant="default" size="sm">
          報告書を確定
        </Button>
      </ActionRail>
    </div>
  );
}
