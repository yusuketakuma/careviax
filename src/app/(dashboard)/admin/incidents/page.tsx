import { IncidentsContent } from './incidents-content';

export const metadata = {
  title: 'ヒヤリハット管理 — PH-OS',
};

export default function IncidentsPage() {
  return (
    <div className="space-y-5">
      <h1 className="sr-only">ヒヤリハット管理</h1>
      <IncidentsContent />
    </div>
  );
}
