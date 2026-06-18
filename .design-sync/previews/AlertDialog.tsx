import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogMedia,
} from 'ph-os';
import { AlertTriangleIcon } from 'lucide-react';

export function DestructiveDefault() {
  return (
    <div style={{ position: 'relative', minHeight: 280, padding: 20 }}>
      <AlertDialog defaultOpen modal={false}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>処方記録を削除しますか</AlertDialogTitle>
            <AlertDialogDescription>
              山田 太郎 様の 2026/06/12
              調剤記録を削除します。この操作は取り消せません。監査ログには削除履歴が残ります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction variant="destructive">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function WithMedia() {
  return (
    <div style={{ position: 'relative', minHeight: 280, padding: 20 }}>
      <AlertDialog defaultOpen modal={false}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <AlertTriangleIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>併用禁忌が検出されました</AlertDialogTitle>
            <AlertDialogDescription>
              ワルファリン × NSAIDs
              の組み合わせは出血リスクが高まります。処方医へ疑義照会を行ってから調剤を続行してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>調剤を中断</AlertDialogCancel>
            <AlertDialogAction>疑義照会へ進む</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CompactSm() {
  return (
    <div style={{ position: 'relative', minHeight: 240, padding: 20 }}>
      <AlertDialog defaultOpen modal={false}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>下書きを破棄</AlertDialogTitle>
            <AlertDialogDescription>
              服薬指導記録の編集内容が保存されていません。破棄しますか。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>戻る</AlertDialogCancel>
            <AlertDialogAction variant="destructive">破棄</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
