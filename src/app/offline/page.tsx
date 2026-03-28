import { ErrorState } from '@/components/ui/error-state';

export default function OfflinePage() {
  return (
    <ErrorState
      variant="network"
      size="page"
      action={{ label: 'ダッシュボードへ戻る', href: '/dashboard' }}
      secondaryAction={{ label: 'ログイン画面へ', href: '/login', variant: 'outline' }}
    />
  );
}
