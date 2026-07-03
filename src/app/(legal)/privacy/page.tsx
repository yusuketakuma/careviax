import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: 'プライバシーポリシー | PH-OS',
  description: 'PH-OS プライバシーポリシー（法務最終確認前のドラフト）',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <article aria-labelledby="privacy-title" className="flex flex-col gap-6">
      <header>
        <h1 id="privacy-title" className="text-2xl font-semibold text-foreground">
          プライバシーポリシー
        </h1>
      </header>

      <section aria-labelledby="privacy-1" className="flex flex-col gap-2">
        <h2 id="privacy-1" className="text-lg font-semibold text-foreground">
          1. 基本方針
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          PH-OS は、在宅医療・訪問薬剤管理業務に必要な個人情報および医療情報を適切に取り扱い、個人情報保護法、医療情報システムの安全管理に関するガイドライン、関連法令・業界ガイドラインを遵守する。
        </p>
      </section>

      <section aria-labelledby="privacy-2" className="flex flex-col gap-2">
        <h2 id="privacy-2" className="text-lg font-semibold text-foreground">
          2. 取得する情報
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>氏名、生年月日、住所、連絡先、保険情報</li>
          <li>処方内容、服薬状況、訪問記録、残薬情報、報告書、連携履歴</li>
          <li>認証情報、端末情報、IP アドレス、操作ログ</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-3" className="flex flex-col gap-2">
        <h2 id="privacy-3" className="text-lg font-semibold text-foreground">
          3. 利用目的
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>在宅患者訪問薬剤管理指導、服薬支援、疑義照会、報告書送付、請求支援</li>
          <li>本人確認、権限管理、不正利用防止、監査対応、障害調査</li>
          <li>法令・契約・同意に基づく外部連携および記録保存</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-4" className="flex flex-col gap-2">
        <h2 id="privacy-4" className="text-lg font-semibold text-foreground">
          4. 安全管理措置
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>認証: Cognito + MFA、セッションタイムアウト、ロールベース認可</li>
          <li>通信: TLS、署名付き URL、アクセス制限</li>
          <li>保存: S3/RDS のアクセス制御、監査ログ、バックアップ、アーカイブ</li>
          <li>運用: 権限棚卸、ログ監視、インシデント対応手順、教育訓練</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-5" className="flex flex-col gap-2">
        <h2 id="privacy-5" className="text-lg font-semibold text-foreground">
          5. 第三者提供
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>法令に基づく場合、または本人同意がある場合を除き、第三者提供は行わない。</li>
          <li>
            クラウド基盤、通知事業者、監視基盤等の委託先を利用する場合は、委託契約により適切に管理する。
          </li>
        </ul>
      </section>

      <section aria-labelledby="privacy-6" className="flex flex-col gap-2">
        <h2 id="privacy-6" className="text-lg font-semibold text-foreground">
          6. 保存期間
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>医療・薬歴・訪問関連記録は法令に従い 5 年以上保存する。</li>
          <li>監査・操作ログは 5 年保存を基準とする。</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-7" className="flex flex-col gap-2">
        <h2 id="privacy-7" className="text-lg font-semibold text-foreground">
          7. 開示等の請求
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>本人または代理人からの開示、訂正、利用停止、第三者提供記録の請求に対応する。</li>
          <li>請求時は本人確認を行い、法令に基づき回答する。</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-8" className="flex flex-col gap-2">
        <h2 id="privacy-8" className="text-lg font-semibold text-foreground">
          8. 問い合わせ窓口
        </h2>
        <ul className="list-disc pl-5 text-sm leading-6 text-muted-foreground">
          <li>運用薬局または契約上の個人情報管理責任者を窓口とする。</li>
          <li>連絡先は導入薬局ごとに設定し、利用者へ明示する。</li>
        </ul>
      </section>

      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>本ポリシーは法務最終確認前のドラフトです。</AlertDescription>
      </Alert>

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
