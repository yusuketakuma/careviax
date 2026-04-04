# Phase 5 API / UI 同期切替戦略 (PRE-04)

## 概要

Phase 5 で Patient API レスポンスが破壊的変更を受ける。Service Worker (SW) キャッシュに古いレスポンスが残存すると UI 不整合が発生するため、キャッシュ無効化と API/UI の同時切替を確実に行う。

---

## 破壊的変更対象一覧

| 画面 / API | 変更内容 | 影響度 |
|---|---|---|
| `GET /api/patients/[id]` (患者詳細) | `allergy_info: Json` → `allergies: PatientAllergy[]`、`gender: string` → `gender: PatientGender` | 高 |
| `GET /api/patients/[id]` (患者詳細) | `medical_insurance_number` 削除 → `insurances: PatientInsurance[]` | 高（請求連動） |
| `PUT /api/patients/[id]` (患者編集) | リクエストボディの `allergy_info`, `gender`, `packaging_preferences` フィールド変更 | 高 |
| `GET /api/patients` (患者一覧) | `gender` 表示列の enum 化、アーカイブ患者の除外デフォルト化 | 中 |
| `GET /api/patients/[id]/share` (外部共有) | アレルギー・保険情報フォーマット変更 | 高 |
| `GET /api/schedules` (スケジュール) | 患者サマリーの `gender`・アレルギー表示変更 | 低 |
| `POST /api/patients/qr-intake` (QR 取込) | `gender` 正規化ロジック変更（→ `unknown` フォールバック） | 中 |

---

## SW キャッシュ無効化戦略

### 1. API レスポンスキャッシュのクリア（Serwist / Workbox）

Phase 5 デプロイ時に SW キャッシュバージョンを更新し、古い Patient API レスポンスを無効化する。

**`public/sw.ts`（または Serwist 設定）で対応:**

```ts
// API キャッシュの revision を更新（ビルド時に自動生成）
// CACHE_VERSION は package.json version または git SHA
const PATIENT_CACHE_VERSION = process.env.NEXT_PUBLIC_BUILD_ID ?? 'v1';

// Patient API ルートを NetworkFirst に設定（キャッシュ優先しない）
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/patients'),
  new NetworkFirst({
    cacheName: `patient-api-${PATIENT_CACHE_VERSION}`,
    networkTimeoutSeconds: 10,
  })
);
```

### 2. SW 更新の強制

```ts
// オフライン復帰時に SW を即時更新
// src/app/layout.tsx または PWA コンポーネント
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    registration.update();
  });
}
```

### 3. IndexedDB (Dexie) キャッシュのクリア

オフラインストアに古い患者データが残存する場合、スキーマバージョンを上げてマイグレーション：

```ts
// src/lib/offline/db.ts
const db = new Dexie('careviax-offline');
db.version(2).stores({
  patients: 'id, org_id, name_kana, gender, is_archived',
  // v1 との差分: gender が enum 文字列に変更、is_archived 追加
}).upgrade(tx => {
  return tx.table('patients').toCollection().modify(patient => {
    // gender の正規化（旧 'other' → 新 'unknown' に変換）
    if (!['male', 'female', 'other', 'unknown'].includes(patient.gender)) {
      patient.gender = 'unknown';
    }
  });
});
```

---

## QR 取込の gender='unknown' 正規化方針

QR コード（調剤録・処方箋など）から性別を読み取る際、認識できない値は `unknown` に正規化する。

### 正規化マッピング（`src/lib/utils/gender.ts`）

```ts
export function normalizeGenderFromQr(raw: string | null | undefined): PatientGender {
  if (!raw) return 'unknown';
  const normalized = raw.trim().toLowerCase();
  const map: Record<string, PatientGender> = {
    '男': 'male',
    '男性': 'male',
    'm': 'male',
    'male': 'male',
    '1': 'male',   // HL7 コード
    '女': 'female',
    '女性': 'female',
    'f': 'female',
    'female': 'female',
    '2': 'female', // HL7 コード
  };
  return map[normalized] ?? 'unknown';
}
```

### QR 取込 UI でのユーザー確認

`gender === 'unknown'` の場合、取込確認画面で性別を必須選択にする：

```
⚠️ 性別が特定できませんでした。正しい値を選択してください。
[男性] [女性] [その他] [不明]
```

---

## デプロイ時の API バージョニング方針

Phase 5 では `/api/v2/patients` 等のバージョン分岐は行わない。

理由:
- 外部クライアントは存在しない（内部 UI のみが Consumer）
- SW キャッシュ無効化で古いレスポンスを確実にクリアできる
- バージョン分岐のメンテナンスコストが不要

代わりに、デプロイと同時に SW キャッシュを強制更新し、全クライアントが新 API を参照するよう誘導する。

---

## 切替後の動作確認項目

- [ ] `GET /api/patients/[id]` で `allergies` 配列が返ること
- [ ] `GET /api/patients/[id]` で `insurances` 配列が返ること
- [ ] `gender` フィールドが `PatientGender` enum 値であること
- [ ] アーカイブ患者が `GET /api/patients` から除外されること（`?include_archived=true` で取得可）
- [ ] QR 取込で未知の gender 値が `unknown` に変換されること
- [ ] SW キャッシュ更新後に旧レスポンスが返らないこと（DevTools で確認）
- [ ] オフラインモードで Dexie スキーマが v2 に移行されること
