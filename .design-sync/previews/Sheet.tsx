import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  Button,
  Label,
  Input,
  Separator,
} from 'ph-os';

export function PatientDetailRight() {
  return (
    <div style={{ position: 'relative', minHeight: 460, padding: 0 }}>
      <Sheet defaultOpen modal={false}>
        <SheetContent side="right" showOverlay={false}>
          <SheetHeader>
            <SheetTitle>佐藤 ハナ 様</SheetTitle>
            <SheetDescription helpTitle="患者概要">
              要介護3 / 訪問頻度 週1回 / 担当: 鈴木薬剤師
            </SheetDescription>
          </SheetHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px', fontSize: 14, lineHeight: 1.6 }}>
            <div>生年月日: 1941/03/08（85歳）</div>
            <Separator />
            <div>主病名: 高血圧症、骨粗鬆症</div>
            <div>残薬調整: アムロジピン 12錠</div>
            <div>次回訪問: 2026/06/24（火）10:30</div>
          </div>
          <SheetFooter>
            <Button>服薬指導記録を作成</Button>
            <Button variant="outline">閉じる</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function FilterLeft() {
  return (
    <div style={{ position: 'relative', minHeight: 460, padding: 0 }}>
      <Sheet defaultOpen modal={false}>
        <SheetContent side="left" showOverlay={false}>
          <SheetHeader>
            <SheetTitle>絞り込み条件</SheetTitle>
            <SheetDescription helpTitle="検索条件">
              訪問予定の一覧を条件で絞り込みます。
            </SheetDescription>
          </SheetHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="sheet-area">エリア</Label>
              <Input id="sheet-area" defaultValue="世田谷区 北沢" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="sheet-staff">担当薬剤師</Label>
              <Input id="sheet-staff" defaultValue="鈴木 / 高橋" />
            </div>
          </div>
          <SheetFooter>
            <Button>適用</Button>
            <Button variant="ghost">条件をクリア</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ActionsBottom() {
  return (
    <div style={{ position: 'relative', minHeight: 320, padding: 0 }}>
      <Sheet defaultOpen modal={false}>
        <SheetContent side="bottom" showOverlay={false}>
          <SheetHeader>
            <SheetTitle>調剤アクション</SheetTitle>
            <SheetDescription helpTitle="操作">
              この処方に対して実行できる操作を選択します。
            </SheetDescription>
          </SheetHeader>
          <div style={{ display: 'flex', gap: 8, padding: '0 16px 16px', flexWrap: 'wrap' }}>
            <Button>監査へ送る</Button>
            <Button variant="outline">疑義照会</Button>
            <Button variant="outline">一包化指示</Button>
            <Button variant="destructive">取消</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
