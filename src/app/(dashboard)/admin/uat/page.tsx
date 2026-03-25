import { Metadata } from 'next';
import { UatContent } from './uat-content';

export const metadata: Metadata = {
  title: 'パイロット UAT — CareViaX',
};

export default function UatPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          パイロット UAT チェックリスト
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 1b パイロット運用の受入テスト項目とフィードバック収集
        </p>
      </div>

      <UatContent />
    </div>
  );
}
