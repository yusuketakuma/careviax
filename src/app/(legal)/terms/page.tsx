import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: '利用規約 | PH-OS',
  description: 'PH-OS 利用規約（法務確認中）',
  robots: { index: false, follow: false },
};

const SECTIONS = [
  '適用範囲',
  'アカウントの登録・管理',
  '禁止事項',
  '免責事項',
  '準拠法・管轄裁判所',
];

export default function TermsPage() {
  return (
    <article aria-labelledby="terms-title" className="flex flex-col gap-6">
      <header>
        <h1 id="terms-title" className="text-2xl font-semibold text-foreground">
          利用規約
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          本サービス（PH-OS）の利用にあたっての条件を定めるものです。
        </p>
      </header>

      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          利用規約は現在法務確認中です。確定後に掲載します。ご不明な点は事業者までお問い合わせください。
        </AlertDescription>
      </Alert>

      <section aria-labelledby="terms-outline-title" className="flex flex-col gap-3">
        <h2 id="terms-outline-title" className="text-lg font-semibold text-foreground">
          構成（予定）
        </h2>
        <ol className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
          {SECTIONS.map((section, index) => (
            <li key={section} className="rounded-lg border border-border/70 bg-background/60 p-3">
              <span className="font-semibold text-foreground">
                第{index + 1}条 {section}
              </span>
              <p className="mt-1">本文は法務確認後に掲載予定です（TBD）。</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-sm leading-6 text-muted-foreground">
        利用規約に関するお問い合わせは、契約先の事業者担当窓口までご連絡ください。
      </p>

      <div className="mt-2 flex justify-center">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ログイン画面に戻る
        </Link>
      </div>
    </article>
  );
}
