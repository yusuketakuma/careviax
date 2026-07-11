'use client';

import { createRouteErrorBoundary } from '@/components/ui/route-error-boundary';

export default createRouteErrorBoundary('PlatformError', {
  recoveryHref: '/platform',
  recoveryLabel: 'プラットフォームコンソールへ戻る',
});
