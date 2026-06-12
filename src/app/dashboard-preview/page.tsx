import Link from 'next/link';
import { ArrowRight, Eye } from 'lucide-react';
import { DashboardContent } from '@/app/(dashboard)/dashboard/dashboard-content';

export default function DashboardPreviewPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1 text-[11px] font-medium uppercase text-muted-foreground">
              <Eye className="size-3.5" aria-hidden="true" />
              Preview
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
              PH-OS ダッシュボード
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              現行の運用コックピットと業務導線を確認します。
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            本番導線
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="p-6">
        <DashboardContent />
      </div>
    </div>
  );
}
