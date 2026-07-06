import { Building2 } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="w-full max-w-2xl">
        <div className="mb-5 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="text-left">
            <h1 className="text-lg font-semibold leading-tight text-foreground">PH-OS</h1>
            <p className="text-xs text-muted-foreground">在宅薬局オペレーション</p>
          </div>
        </div>
        <div className="flex w-full justify-center">{children}</div>
        <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
          3省2ガイドライン準拠 / ISMAP準拠 AWS基盤
        </p>
      </div>
    </main>
  );
}
