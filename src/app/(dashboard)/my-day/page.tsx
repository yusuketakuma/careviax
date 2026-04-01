import type { Metadata } from 'next';
import { MyDayContent } from './my-day-content';

export const metadata: Metadata = {
  title: 'My Day — CareViaX',
};

export default function MyDayPage() {
  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Day</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          今日の担当訪問・未完了タスク・未解決課題をまとめて確認
        </p>
      </div>
      <MyDayContent />
    </div>
  );
}
