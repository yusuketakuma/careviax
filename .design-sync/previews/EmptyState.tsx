import { EmptyState } from 'ph-os';
import { FileQuestion, CalendarPlus, Inbox } from 'lucide-react';

export function NoVisits() {
  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <EmptyState
        icon={CalendarPlus}
        title="本日の訪問予定はありません"
        description="新しい訪問予定を登録すると、ここに当日のスケジュールが表示されます。"
        action={{ label: '訪問予定を追加', onClick: () => {} }}
      />
    </div>
  );
}

export function NoDocuments() {
  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <EmptyState
        icon={FileQuestion}
        title="登録された処方箋がありません"
        description="QRコードを読み取るか、手入力で処方箋を登録してください。"
      />
    </div>
  );
}

export function MinimalNoIcon() {
  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <EmptyState
        icon={Inbox}
        title="未読の疑義照会はありません"
      />
    </div>
  );
}
