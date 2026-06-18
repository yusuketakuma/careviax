import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Button,
} from 'ph-os';
import { PencilIcon, CopyIcon, SendIcon, Trash2Icon, ChevronDownIcon } from 'lucide-react';

// base-ui Menu portals its popup to document.body (Floating-UI anchored to the
// trigger), so an open menu cannot be captured inside a per-cell screenshot
// crop. These previews therefore show the real, DS-styled trigger; the menu
// opens on click in the live design tool (item set documented in the prompt).

export function ActionsMenu() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 24 }}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          処方の操作
          <ChevronDownIcon />
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
              処方医へ送信
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Trash2Icon />
            削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PlainTrigger() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 24 }}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          並び替え
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>新しい順</DropdownMenuItem>
          <DropdownMenuItem>古い順</DropdownMenuItem>
          <DropdownMenuItem>優先度順</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
