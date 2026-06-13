# BACKEND_GAP_PLAN — 第1波 backend 差分

> 第1波で backend を触るのは **X-B0 の BE 部のみ**（cross-boundary 逐次の前段）。

## X-B0-BE: membership role を session に露出
### 現状（recon 確認済）
- server-side 認可は `src/lib/auth/context.ts` の `getMembership(userId, orgId)→{role}`(:72-88) と `requireAuthContext` が `role: membership.role`(:199) を持つ＝**サーバ側は role 解決済み**。
- だが NextAuth の **session(client)** には org membership role が**載っていない**（`config.ts` jwt callback:91 は `normalizePhosRole`(Cognito/phos role) のみ、session callback:175 に membership role なし）。
- → client（AppProvider）は role を受け取れない。

### 変更方針（minimal diff）
- `src/lib/auth/config.ts` の `session({session, token})` で、現在の org に対する membership role を session.user に付与（既存 `getMembership`/context helper を再利用。org 解決は既存の org 選択（orgId）に従う）。
- 性能: session callback は頻繁に呼ばれるため、role は **JWT(token) に保持**して session へ写すのが望ましい（`jwt` callback で membership role を token に格納 → `session` で写像）。DB 往復を毎回増やさない。
- session 型に `user.role`（`MemberRole`）を追加（型拡張ファイル）。
- **認可ロジックは変更しない**（`permissions.ts`/RLS は不変。これは表示用の role 露出のみ）。

### リスク / 注意
- org 切替（select-site/select-mode）時に role が更新されること（token 再発行 or session 再取得の経路を確認）。
- 複数 org membership の場合、現在 org の role を選ぶ（`getMembership(userId, currentOrgId)`）。
- migration 不要（Membership テーブル既存）。後方互換（role 未取得時は null fallback、shell は名前のみ表示）。

### テスト
→ [[TEST_PLAN]] の auth 節。
