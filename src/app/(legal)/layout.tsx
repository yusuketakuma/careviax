import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted px-4 py-8">
      <div className="mx-auto flex max-w-3xl flex-col items-center">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <svg
                className="h-7 w-7 text-primary-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
          </div>
          <Link
            href="/login"
            className="text-xl font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            PH-OS
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">在宅薬局オペレーション</p>
        </div>
        <div className="w-full rounded-2xl border border-border/80 bg-card p-6 text-card-foreground shadow-sm sm:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          3省2ガイドライン準拠 / ISMAP準拠 AWS基盤
        </p>
      </div>
    </div>
  );
}
