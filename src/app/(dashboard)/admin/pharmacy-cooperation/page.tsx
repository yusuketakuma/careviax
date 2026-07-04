import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { PharmacyCooperationSetupContent } from './pharmacy-cooperation-setup-content';

export const metadata: Metadata = {
  title: '薬局間協力設定 — PH-OS',
};

export default function PharmacyCooperationSetupPage() {
  return (
    <PageScaffold>
      <AdminPageHeader
        title="薬局間協力設定"
        description="協力薬局、薬局間連携、契約を登録し、協力訪問と月次請求の前提データを整えます。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">設定順序</p>
            <p className="text-sm text-muted-foreground">
              協力薬局を登録し、基準薬局との連携を有効化してから契約を作成します。
            </p>
          </div>
        }
        shortcuts={[
          { href: '/workflow/pharmacy-cooperation', label: '協力ワークフロー' },
          { href: '/billing/partner-cooperation', label: '月次請求' },
          { href: '/admin/pharmacy-sites', label: '薬局情報' },
        ]}
      />

      <Suspense fallback={<Loading label="薬局間協力設定を読み込み中..." />}>
        <PharmacyCooperationSetupContent />
      </Suspense>
    </PageScaffold>
  );
}
