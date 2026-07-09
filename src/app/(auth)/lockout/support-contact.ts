/**
 * lockout 画面の管理者連絡先(SSOT 6.3: プレースホルダ固定値の禁止)。
 * 未認証画面のため org 解決は不可能で、導入先ごとに build 時 env
 * (NEXT_PUBLIC_SUPPORT_CONTACT_{NAME,PHONE,EMAIL}) で注入する。
 * 未設定は null(捏造しない)。純関数として切り出し、設定済み分岐をテスト可能にする。
 */
export type SupportContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  hasContact: boolean;
};

function normalized(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveSupportContact(
  env: Record<string, string | undefined> = process.env,
): SupportContact {
  const name = normalized(env.NEXT_PUBLIC_SUPPORT_CONTACT_NAME);
  const phone = normalized(env.NEXT_PUBLIC_SUPPORT_CONTACT_PHONE);
  const email = normalized(env.NEXT_PUBLIC_SUPPORT_CONTACT_EMAIL);
  return { name, phone, email, hasContact: Boolean(phone || email) };
}
