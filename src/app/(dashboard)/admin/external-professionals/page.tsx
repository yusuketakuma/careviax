import { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminExternalProfessionalsShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { Loading } from '@/components/ui/loading';
import { ExternalProfessionalsContent } from './external-professionals-content';

export const metadata: Metadata = {
  title: '他職種マスター — CareViaX',
};

export default function ExternalProfessionalsPage() {
  return (
    <div className="p-6">
      <AdminPageHeader
        title="他職種マスター"
        description="医師・看護師・ケアマネジャー等の連携先を管理します。"
        shortcuts={getAdminExternalProfessionalsShortcutLinks()}
      />

      <Suspense fallback={<Loading />}>
        <ExternalProfessionalsContent />
      </Suspense>
    </div>
  );
}
