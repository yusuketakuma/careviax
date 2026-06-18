import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Label,
} from 'ph-os';

export function EditPatient() {
  return (
    <div style={{ position: 'relative', minHeight: 360, padding: 20 }}>
      <Dialog defaultOpen modal={false}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>患者情報の編集</DialogTitle>
            <DialogDescription>
              基本情報を更新します。保険証区分の変更は次回訪問時の算定に反映されます。
            </DialogDescription>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="dlg-name">氏名</Label>
              <Input id="dlg-name" defaultValue="佐藤 ハナ" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="dlg-kana">フリガナ</Label>
              <Input id="dlg-kana" defaultValue="サトウ ハナ" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline">キャンセル</Button>
            <Button>保存する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Confirmation() {
  return (
    <div style={{ position: 'relative', minHeight: 320, padding: 20 }}>
      <Dialog defaultOpen modal={false}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>訪問予定の確定</DialogTitle>
            <DialogDescription>
              2026年6月20日（金）14:00 の在宅訪問を確定します。担当ヘルパーへ通知されます。
            </DialogDescription>
          </DialogHeader>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            山田 太郎 様（要介護2）への定期訪問を確定してよろしいですか。確定後はスケジュールに反映されます。
          </p>
          <DialogFooter>
            <Button variant="outline">戻る</Button>
            <Button>確定する</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
