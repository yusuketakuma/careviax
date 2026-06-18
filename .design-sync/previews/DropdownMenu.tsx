import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  Button,
} from 'ph-os';
import {
  PencilIcon,
  CopyIcon,
  SendIcon,
  Trash2Icon,
  MoreHorizontalIcon,
} from 'lucide-react';

export function ActionsMenu() {
  return (
    <div style={{ position: 'relative', minHeight: 280, padding: 20 }}>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>処方の操作</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <PencilIcon />
              編集
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <CopyIcon />
              複製
            </DropdownMenuItem>
            <DropdownMenuItem>
              <SendIcon />
              監査へ送る
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2Icon />
            削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function CheckboxColumns() {
  return (
    <div style={{ position: 'relative', minHeight: 280, padding: 20 }}>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          表示する列
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>表示項目</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>患者名</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked>訪問予定日</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>要介護度</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked>担当薬剤師</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function RadioSort() {
  return (
    <div style={{ position: 'relative', minHeight: 260, padding: 20 }}>
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          並び替え
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>並び替え基準</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="visit">
            <DropdownMenuRadioItem value="visit">訪問予定日順</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="name">氏名（カナ）順</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="care">要介護度順</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
