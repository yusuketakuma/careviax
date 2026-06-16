import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * design/manifest.json の screen_id と実装ルートの対応表。
 * docs/design-fidelity-mapping.md が運用上の SSOT。ここはその機械可読版。
 *
 * - route: 撮影対象 URL(null = 対応ページ未実装 or 動的 ID 未解決 → skip して報告)
 * - auth: false のときはローカルセッションを付与せず撮影(ログイン画面など)
 * - viewport: 省略時は 1600x1000(デザイン PNG と同寸)
 * - setup: 撮影前の追加操作(モーダルを開く等)
 */
export type DesignScreenEntry = {
  screenId: string;
  /** design/images からの相対パス(manifest.json の file と一致) */
  targetImage: string;
  route: string | null;
  auth?: boolean;
  viewport?: { width: number; height: number };
  setup?: (page: Page) => Promise<void>;
  /** route が null の理由(レポートに出す) */
  note?: string;
};

export const DESIGN_VIEWPORT = { width: 1600, height: 1000 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

export const DESIGN_IMAGE_ROOT = path.join(process.cwd(), 'design');

export const DESIGN_FIDELITY_OUTPUT_DIR =
  process.env.DESIGN_FIDELITY_DIR ??
  path.join(process.cwd(), 'tools', 'tests', '.artifacts', 'design-fidelity');

export const DESIGN_SCREENS: DesignScreenEntry[] = [
  // ── 新ターゲット(design/images/new、2026-06-11〜最優先)──────
  // route は暫定。new-design-analysis の読解結果で調整する
  {
    screenId: 'new_01_dashboard',
    targetImage: 'images/new/01_dashboard.png',
    route: '/dashboard',
    setup: async (page) => {
      await page.waitForSelector(
        '[data-testid="dashboard-urgent-now"], [data-testid="dashboard-today-flow"], [data-testid="dashboard-process-now"]',
        { timeout: 60_000 },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_02_patient_list',
    targetImage: 'images/new/02_patient_list.png',
    route: '/patients',
    setup: async (page) => {
      await page
        .waitForSelector(
          '[data-testid="patient-board-card"], [data-testid="patients-board-grid"]',
          {
            timeout: 30_000,
          },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_03_schedule',
    targetImage: 'images/new/03_schedule.png',
    route: '/schedules',
  },
  {
    screenId: 'new_04_visit',
    targetImage: 'images/new/04_visit.png',
    route: '/visits',
    setup: async (page) => {
      // cold compile 直後はスケルトンのまま撮れてしまうため、準備カードの描画を待つ
      await page
        .waitForSelector('[data-testid="visit-prep-card"], [data-testid="visits-today-list"]', {
          timeout: 20_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_05_import',
    targetImage: 'images/new/05_import.png',
    route: '/prescriptions/intake',
  },
  {
    screenId: 'new_06_card',
    targetImage: 'images/new/06_card.png',
    // prisma/seed-design-demo.ts の田中一郎(セット監査待ちサイクル)
    route: '/patients/cmnhdemopt001amq9ph-os',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="card-prescription-section"]', {
        timeout: 60_000,
      });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_07_dispense',
    targetImage: 'images/new/07_dispense.png',
    route: '/dispense',
    setup: async (page) => {
      // 調剤キュー先頭を選択し、「いまの1件」(比較テーブル+チェックリスト)の描画まで待つ
      await page.getByTestId('dispense-queue-row').first().click();
      await page
        .waitForSelector(
          '[data-testid="dispense-comparison-table"], [data-testid="dispense-checklist"]',
          { timeout: 90_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_08_audit',
    targetImage: 'images/new/08_audit.png',
    route: '/auditing',
    setup: async (page) => {
      // 私の監査キュー先頭(麻薬・田中)を選択して中央の監査詳細を開く
      await page.getByTestId('audit-queue-row').first().click();
      // workbench API 取得 → 二人制バナー/計数テーブルの描画まで待つ
      await page
        .waitForSelector('[data-testid="audit-count-table"], [data-testid="two-person-banner"]', {
          timeout: 20_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_09_set',
    targetImage: 'images/new/09_set.png',
    route: '/medication-sets',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="set-workspace-row"], [data-testid="set-pending-card"]', {
          timeout: 30_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_10_report',
    targetImage: 'images/new/10_report.png',
    route: '/reports',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="report-draft-row"], [data-testid="report-waiting-box"]', {
          timeout: 30_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_11_billing',
    targetImage: 'images/new/11_billing.png',
    route: '/billing',
    setup: async (page) => {
      await page
        .waitForSelector(
          '[data-testid="billing-check-review-row"], [data-testid="billing-check-review-table"], [data-testid="billing-check"]',
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_12_handoff',
    targetImage: 'images/new/12_handoff.png',
    route: '/handoff',
  },
  {
    screenId: 'new_13_master',
    targetImage: 'images/new/13_master.png',
    route: '/admin',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="master-hub-card"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'new_14_settings',
    targetImage: 'images/new/14_settings.png',
    route: '/settings',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="policy-safety-card"], [data-testid="policy-row"]', {
          timeout: 30_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  // ── 認証・横断 ──────────────────────────────────────────────
  {
    screenId: 'p0_01_login_mfa',
    targetImage: 'images/P0/p0_01_login_mfa.png',
    route: '/login',
    auth: false,
  },
  {
    screenId: 'p0_02_tenant_pharmacy_select',
    targetImage: 'images/P0/p0_02_tenant_pharmacy_select.png',
    route: '/select-site',
  },
  {
    screenId: 'p0_03_mode_role_select',
    targetImage: 'images/P0/p0_03_mode_role_select.png',
    route: '/select-mode',
  },
  {
    screenId: 'p0_04_notification_center',
    targetImage: 'images/P0/p0_04_notification_center.png',
    route: '/notifications',
  },
  {
    screenId: 'p0_05_global_search',
    targetImage: 'images/P0/p0_05_global_search.png',
    route: '/search',
    setup: async (page) => {
      // 検索ボックスへ seed 患者名を入力 → 患者カテゴリ(初期選択)に結果が出る
      await page.fill('[data-search-input]', '田中');
      // デバウンス + 並列 fetch 完了(「検索中...」が消える)まで待つ
      await page
        .waitForFunction(() => !document.body.textContent?.includes('検索中'), undefined, {
          timeout: 20_000,
        })
        .catch(() => {});
      await page.waitForTimeout(300);
    },
  },
  {
    screenId: 'p0_06_advanced_search_modal',
    targetImage: 'images/P0/p0_06_advanced_search_modal.png',
    route: '/search',
    setup: async (page) => {
      await page.getByRole('button', { name: '詳しく絞り込む' }).click();
      // Dialog のフェードイン待ち
      await page.waitForTimeout(600);
    },
  },
  // ── ダッシュボード・カード ──────────────────────────────────
  {
    screenId: 'p0_07_dashboard_cardgrid',
    targetImage: 'images/P0/p0_07_dashboard_cardgrid.png',
    route: '/dashboard',
    setup: async (page) => {
      await page.waitForSelector(
        '[data-testid="dashboard-urgent-now"], [data-testid="dashboard-today-flow"], [data-testid="dashboard-process-now"]',
        { timeout: 60_000 },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_08_card_detail_workspace',
    targetImage: 'images/P0/p0_08_card_detail_workspace.png',
    // prisma/seed-design-demo.ts の田中一郎(セット監査待ちサイクル)固定 ID
    route: '/patients/cmnhdemopt001amq9ph-os',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="card-prescription-section"]', { timeout: 120_000 });
      await page.waitForTimeout(400);
    },
  },
  // ── 処方 ────────────────────────────────────────────────────
  {
    screenId: 'p0_09_prescription_import',
    targetImage: 'images/P0/p0_09_prescription_import.png',
    route: '/prescriptions/new',
  },
  {
    screenId: 'p0_10_prescription_entry_period',
    targetImage: 'images/P0/p0_10_prescription_entry_period.png',
    route: '/prescriptions/new',
    setup: async (page) => {
      // dev 限定 window フックでデモ5明細を注入し、期間レビューカードへスクロール
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedPeriodReviewDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (
            window as unknown as { __phosSeedPeriodReviewDemo?: () => void }
          ).__phosSeedPeriodReviewDemo?.(),
        )
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="prescription-period-review"]', { timeout: 20_000 })
        .catch(() => {});
      await page
        .evaluate(() => {
          document
            .querySelector('[data-testid="prescription-period-review"]')
            ?.scrollIntoView({ block: 'start' });
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_11_prescription_diff_review',
    targetImage: 'images/P0/p0_11_prescription_diff_review.png',
    route: null,
    note: '患者詳細配下(動的 ID)。デモ患者 seed 後にマッピング',
  },
  // ── 調剤・監査・セット ──────────────────────────────────────
  {
    screenId: 'p0_12_dispensing_workbench',
    targetImage: 'images/P0/p0_12_dispensing_workbench.png',
    route: '/dispense',
    setup: async (page) => {
      await page.getByTestId('dispense-queue-row').first().click();
      await page.waitForSelector(
        '[data-testid="dispense-comparison-table"], [data-testid="dispense-checklist"]',
        { timeout: 90_000 },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_13_dispensing_audit',
    targetImage: 'images/P0/p0_13_dispensing_audit.png',
    route: '/auditing',
    setup: async (page) => {
      await page.getByTestId('audit-queue-row').first().click();
      await page
        .waitForSelector('[data-testid="audit-count-table"], [data-testid="two-person-banner"]', {
          timeout: 90_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_14_set_preparation',
    targetImage: 'images/P0/p0_14_set_preparation.png',
    route: '/medication-sets',
  },
  {
    screenId: 'p0_15_set_audit',
    targetImage: 'images/P0/p0_15_set_audit.png',
    route: '/medication-sets',
    note: 'セット鑑査タブ/ビューの切替操作は実装フェーズで追加',
  },
  // ── スケジュール・ルート ────────────────────────────────────
  {
    screenId: 'p0_16_schedule_gantt_all_staff',
    targetImage: 'images/P0/p0_16_schedule_gantt_all_staff.png',
    route: '/schedules',
    setup: async (page) => {
      await page.waitForSelector(
        '[data-testid="team-board-row"], [data-testid="team-board-idle"]',
        {
          timeout: 120_000,
        },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_17_schedule_confirmation_flow',
    targetImage: 'images/P0/p0_17_schedule_confirmation_flow.png',
    route: '/schedules/proposals?workspace=dashboard',
    setup: async (page) => {
      // 先頭の確定フローを開き、詳細データが描画された状態だけを撮影する。
      await page
        .getByRole('button', { name: /確定フローを開く/ })
        .first()
        .click();
      await page.waitForSelector('[data-testid="proposal-flow-steps"]', { timeout: 120_000 });
      await page.waitForSelector('[data-testid="proposal-medication-workflow"]', {
        timeout: 120_000,
      });
      await page
        .getByText('確定フローを読み込み中...')
        .waitFor({ state: 'detached', timeout: 120_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_18_schedule_create_edit_drawer',
    targetImage: 'images/P0/p0_18_schedule_create_edit_drawer.png',
    route: null,
    note: '作成/編集ドロワーの起動操作は実装フェーズで追加',
  },
  {
    screenId: 'p0_19_schedule_conflict_resolution',
    targetImage: 'images/P0/p0_19_schedule_conflict_resolution.png',
    route: null,
    note: '重複解消ビューの再現データ整備後にマッピング',
  },
  {
    screenId: 'p0_20_emergency_route_recalculation',
    targetImage: 'images/P0/p0_20_emergency_route_recalculation.png',
    route: null,
    note: '緊急差込フローの再現データ整備後にマッピング',
  },
  {
    screenId: 'p0_21_route_optimization_detail',
    targetImage: 'images/P0/p0_21_route_optimization_detail.png',
    route: null,
    note: 'ルート詳細の正ルート精査後にマッピング',
  },
  // ── 訪問 ────────────────────────────────────────────────────
  {
    screenId: 'p0_22_visit_mode_tablet',
    targetImage: 'images/P0/p0_22_visit_mode_tablet.png',
    // 田中一郎の当日訪問(seed-design-demo 固定 ID)の記録画面 + 訪問ステップレール
    route: '/visits/cmnhdemovis001amq9ph-os/record',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="visit-step-nav"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_23_visit_mode_smartphone',
    targetImage: 'images/P0/p0_23_visit_mode_smartphone.png',
    // 田中一郎の当日訪問(p0_22 と同じ)をモバイル没入型ウィザードで撮影
    route: '/visits/cmnhdemovis001amq9ph-os/record',
    viewport: MOBILE_VIEWPORT,
    setup: async (page) => {
      // モバイル没入ヘッダ(PH-OS+ステップドット)の描画を待つ
      await page
        .waitForSelector('[data-testid="visit-mobile-mode-header"]', { timeout: 30_000 })
        .catch(() => {});
      // dev 限定 window フックで未同期写真 2 件を注入(未同期2 バッジ+橙バナー)
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedVisitModeDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (
            window as unknown as { __phosSeedVisitModeDemo?: () => void }
          ).__phosSeedVisitModeDemo?.(),
        )
        .catch(() => {});
      // target と同じステップ「服薬・副作用」へ進み、「きちんと飲めている」を選択
      await page
        .getByRole('button', { name: /^ステップ4/ })
        .click()
        .catch(() => {});
      await page
        .getByRole('button', { name: 'きちんと飲めている' })
        .click()
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_24_facility_visit_packet',
    targetImage: 'images/P0/p0_24_facility_visit_packet.png',
    // 小川タケ(グリーンヒル施設バッチ)の施設訪問パケット(seed-design-demo 固定 ID)
    route: '/visits/cmnhdemovis010amq9ph-os/facility-packet',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="facility-packet-page"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  // ── 事務・連携 ──────────────────────────────────────────────
  {
    screenId: 'p0_25_clerk_support_dashboard',
    targetImage: 'images/P0/p0_25_clerk_support_dashboard.png',
    // 事務サポート専用ページ(BFF: /api/dashboard/clerk-support)
    route: '/clerk-support',
  },
  {
    screenId: 'p0_26_contact_delivery_target_edit',
    targetImage: 'images/P0/p0_26_contact_delivery_target_edit.png',
    // 送付先一覧から連携先を選び、右ペインで連絡先を編集する現行管理ワークスペース
    route: '/admin/contact-profiles',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="contact-delivery-target-edit"]', {
        timeout: 120_000,
      });
      await page.waitForSelector('#contact-name', {
        timeout: 120_000,
      });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_27_handoff_bidirectional',
    targetImage: 'images/P0/p0_27_handoff_bidirectional.png',
    route: '/handoff',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="handoff-consult-workspace"]', { timeout: 60_000 });
      await page.waitForSelector('[data-testid="handoff-outgoing-section"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_28_report_composer_share',
    targetImage: 'images/P0/p0_28_report_composer_share.png',
    // 加藤ミサのケアマネ向け報告書(seed-design-demo 固定 ID)を標準詳細から composer state へ進める
    route: '/reports/cmnhdemorep001amq9ph-os',
    setup: async (page) => {
      await page.getByRole('button', { name: '共有を作成' }).click();
      await page.waitForSelector('[data-testid="report-composer"]', { timeout: 120_000 });
      await page.waitForSelector('text=送付前チェック', { timeout: 120_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_29_reply_followup_management',
    targetImage: 'images/P0/p0_29_reply_followup_management.png',
    route: '/communications/requests?status=sent&patient_id=cmnhdemopt009amq9ph-os',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="reply-followup-list"]', { timeout: 120_000 });
      await page.waitForSelector('text=返信内容と次の対応', { timeout: 120_000 });
      await page.waitForTimeout(400);
    },
  },
  // ── 請求・残薬 ──────────────────────────────────────────────
  {
    screenId: 'p0_30_claim_billing_review',
    targetImage: 'images/P0/p0_30_claim_billing_review.png',
    route: '/billing',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="billing-check-review-table"]', {
        timeout: 120_000,
      });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_31_residual_adjustment_flow',
    targetImage: 'images/P0/p0_31_residual_adjustment_flow.png',
    // prisma/seed-design-demo.ts の田中一郎(残薬3剤+回答済みの残薬調整照会)
    route: '/patients/cmnhdemopt001amq9ph-os/residual-adjustment',
    setup: async (page) => {
      // 残薬カードと調整案テーブルの描画(API 取得完了)を待つ
      await page.waitForSelector('[data-testid="adjustment-proposal-row"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  // ── 安全・証跡・オフライン ──────────────────────────────────
  {
    screenId: 'p0_32_adverse_event_prevention_flow',
    targetImage: 'images/P0/p0_32_adverse_event_prevention_flow.png',
    // prisma/seed-design-demo.ts の田中一郎(服薬課題 4 カテゴリ・用量確認のみ相談中)
    route: '/patients/cmnhdemopt001amq9ph-os/safety-check',
    setup: async (page) => {
      // 気になる点カードと確認の流れ(API 取得完了)を待つ
      await page.waitForSelector('[data-testid="safety-concern-interaction"]', {
        timeout: 120_000,
      });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_33_evidence_photo_management',
    targetImage: 'images/P0/p0_33_evidence_photo_management.png',
    route: '/visits/evidence',
    setup: async (page) => {
      // dev 限定の window フックで target と同じ 8 枚(未同期3/同期済み5)を注入
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedEvidenceDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (window as unknown as { __phosSeedEvidenceDemo?: () => void }).__phosSeedEvidenceDemo?.(),
        )
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="evidence-photo-card"]', { timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_34_offline_sync_center',
    targetImage: 'images/P0/p0_34_offline_sync_center.png',
    route: '/offline-sync',
    setup: async (page) => {
      // dev 限定の window フックで同期キューにデモ3状態(同期待ち/失敗/競合)を注入
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedOfflineSyncDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (
            window as unknown as { __phosSeedOfflineSyncDemo?: (mode?: string) => Promise<void> }
          ).__phosSeedOfflineSyncDemo?.('queue'),
        )
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="offline-sync-row"]', { timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_35_data_conflict_resolution',
    targetImage: 'images/P0/p0_35_data_conflict_resolution.png',
    route: '/offline-sync',
    setup: async (page) => {
      // デモ注入後、競合行の「内容を確認」から比較ビューを開く
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedOfflineSyncDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (
            window as unknown as { __phosSeedOfflineSyncDemo?: (mode?: string) => Promise<void> }
          ).__phosSeedOfflineSyncDemo?.('conflict'),
        )
        .catch(() => {});
      await page
        .getByRole('button', { name: '内容を確認' })
        .first()
        .click()
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="offline-sync-conflict-view"]', { timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_36_reject_reason_modal',
    targetImage: 'images/P0/p0_36_reject_reason_modal.png',
    route: '/auditing',
    setup: async (page) => {
      // 監査ワークベンチの差戻しボタンから共通理由モーダル(ReasonDialog)を開く
      await page
        .waitForSelector('[data-testid="audit-reject-button"]', { timeout: 30_000 })
        .catch(() => {});
      await page
        .getByTestId('audit-reject-button')
        .click()
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="reason-dialog"]', { timeout: 20_000 })
        .catch(() => {});
      // target は先頭チップが選択済みの状態
      await page
        .getByTestId('reason-option')
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_37_cancel_reopen_reason_modal',
    targetImage: 'images/P0/p0_37_cancel_reopen_reason_modal.png',
    route: null,
    note: '旧 day-view の取消・再開モーダルは削除。現行スケジュールボード側で再設計する。',
  },
  // ── マスタ・設定 ────────────────────────────────────────────
  {
    screenId: 'p0_38_patient_profile',
    targetImage: 'images/P0/p0_38_patient_profile.png',
    // 田中一郎(seed-design-demo)のプロフィール情報は現行カード内に統合する。
    route: '/patients/cmnhdemopt001amq9ph-os',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="card-workspace"]', { timeout: 60_000 });
      await page.waitForSelector('[data-testid="patient-profile-summary"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_39_medication_master',
    targetImage: 'images/P0/p0_39_medication_master.png',
    route: '/admin/drug-masters',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="drug-master-editor"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_40_medical_professional_master',
    targetImage: 'images/P0/p0_40_medical_professional_master.png',
    route: '/admin/external-professionals',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="external-professionals-master-editor"]', {
        timeout: 60_000,
      });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_41_facility_master',
    targetImage: 'images/P0/p0_41_facility_master.png',
    route: '/admin/facilities',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="facility-master-editor"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_42_staff_role_management',
    targetImage: 'images/P0/p0_42_staff_role_management.png',
    route: '/admin/staff',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="staff-master-editor"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_43_vehicle_master',
    targetImage: 'images/P0/p0_43_vehicle_master.png',
    // 車両マスター 3 カラム(一覧先頭がデフォルト選択済み)
    route: '/admin/vehicles',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="vehicle-master-editor"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_44_settings',
    targetImage: 'images/P0/p0_44_settings.png',
    route: '/settings',
    setup: async (page) => {
      await page.waitForSelector('[data-testid="policy-safety-card"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_45_capacity_bottleneck_dashboard',
    targetImage: 'images/P0/p0_45_capacity_bottleneck_dashboard.png',
    // キャパシティ・詰まり確認(KPI 4 枚 + 行程残/スタッフ負荷バー + 注意点)
    route: '/admin/capacity',
    setup: async (page) => {
      // BFF 集計の取得完了 → KPI とバーの描画まで待つ
      await page
        .waitForSelector('[data-testid="capacity-page"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_46_ui_state_reference',
    targetImage: 'images/P0/p0_46_ui_state_reference.png',
    route: null,
    note: 'UI 状態リファレンス(実装対象外・参照専用)',
  },
  {
    screenId: 'p0_47_print_preview',
    targetImage: 'images/P0/p0_47_print_preview.png',
    // 帳票・印刷プレビューハブ(既定 ?type=set_instruction 相当)
    route: '/reports/print',
    setup: async (page) => {
      // set-plans + prescriptions の取得完了 → A4 プレビューの描画まで待つ
      await page.waitForSelector('[data-testid="print-preview-sheet"]', { timeout: 30_000 });
      await page.waitForSelector('[data-testid="print-sheet-qr"]', { timeout: 30_000 });
      await page.waitForFunction(
        () => !document.body.textContent?.includes('帳票データを読み込み中'),
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p0_48_mobile_evidence_capture',
    targetImage: 'images/P0/p0_48_mobile_evidence_capture.png',
    // 田中一郎の当日訪問(seed-design-demo 固定 ID)のモバイル証跡撮影(没入型)
    route: '/visits/cmnhdemovis001amq9ph-os/capture',
    viewport: MOBILE_VIEWPORT,
    setup: async (page) => {
      // 患者名の解決(visit-schedules API)完了まで待つ(カメラなし環境では
      // target と同じ黒枠+「カメラ」プレースホルダーが表示される)
      await page.waitForSelector('[data-testid="capture-patient-name"]', { timeout: 30_000 });
      await page.waitForTimeout(400);
    },
  },
  // ── P1 ──────────────────────────────────────────────────────
  {
    screenId: 'p1_01_saved_views_advanced_filter',
    targetImage: 'images/P1/p1_01_saved_views_advanced_filter.png',
    // よく使う絞り込み(プリセット4枚+今の絞り込み条件。saved_view は me/preferences)
    route: '/views',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="saved-views-page"]', { timeout: 30_000 })
        .catch(() => {});
      // me/preferences の取得完了 → 条件チップの描画まで待つ
      await page
        .waitForSelector('[data-testid="current-filter-chip"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_02_multi_card_split_workspace',
    targetImage: 'images/P1/p1_02_multi_card_split_workspace.png',
    // 既定 = 「注目すべきカード3枚」(board 先頭=田中一郎 + 返信待ち=加藤 + 回答待ち=高橋)を導出
    route: '/patients/compare',
    setup: async (page) => {
      // board → overview の 2 段 fetch 完了(3 カード描画)まで待つ
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="compare-card"]').length >= 3 &&
          document.querySelectorAll('[data-testid="compare-card-open"]').length >= 3,
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_03_ai_visit_summary_review',
    targetImage: 'images/P1/p1_03_ai_visit_summary_review.png',
    // 田中一郎の当日訪問(seed-design-demo 固定 ID)の訪問前まとめ確認
    route: '/visits/cmnhdemovis001amq9ph-os/brief',
    setup: async (page) => {
      // visit-brief 生成(AI/ルール)完了 → 本文段落の描画まで待つ
      await page
        .waitForSelector('[data-testid="visit-brief-paragraph"]', { timeout: 30_000 })
        .catch(() => {});
      // target は「内容は正しい」選択済みの状態(フィードバックトーストの消滅まで待つ)
      await page
        .getByTestId('pharmacist-confirm-choice')
        .first()
        .click()
        .catch(() => {});
      await page
        .waitForSelector('[data-sonner-toast]', { state: 'attached', timeout: 3_000 })
        .then(() =>
          page.waitForSelector('[data-sonner-toast]', { state: 'detached', timeout: 8_000 }),
        )
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_04_ai_report_draft',
    targetImage: 'images/P1/p1_04_ai_report_draft.png',
    // 伊藤キヨのケアマネ向け下書き(seed-design-demo 固定 ID)を直接開く。
    // /reports からの「→ 下書きへ」クリックに依存すると、メモ付き行や当日データ差分で撮影が不安定になる。
    route: '/reports/cmnhdemorep002amq9ph-os',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="report-ai-draft-review"]', { timeout: 30_000 })
        .catch(() => {});
      await page
        .evaluate(() => {
          document
            .querySelector('[data-testid="report-ai-draft-review"]')
            ?.scrollIntoView({ block: 'start' });
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_05_interprofessional_portal',
    targetImage: 'images/P1/p1_05_interprofessional_portal.png',
    // 加藤ミサのケアマネ向け報告書(seed-design-demo 固定 ID)の共有プレビュー
    route: '/reports/cmnhdemorep001amq9ph-os/share',
    setup: async (page) => {
      // care-team+返信の並列 fetch 完了 → p1_05 は seed 済み返信カードの描画まで待つ
      await page.waitForSelector('[data-testid="share-reply-card"]', { timeout: 30_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_06_management_analytics_detail',
    targetImage: 'images/P1/p1_06_management_analytics_detail.png',
    route: '/admin/operations-insights',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="operations-insights-page"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_07_inventory_linkage_prediction',
    targetImage: 'images/P1/p1_07_inventory_linkage_prediction.png',
    route: '/admin/inventory-forecast',
    setup: async (page) => {
      await page
        .waitForSelector('[data-testid="inventory-forecast-page"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_08_facility_criteria_dashboard',
    targetImage: 'images/P1/p1_08_facility_criteria_dashboard.png',
    route: '/admin/facility-standards',
    setup: async (page) => {
      // 施設基準チェックリストの描画を待ち、セクションへスクロール
      await page
        .waitForSelector('[data-testid="facility-criteria-checklist"]', { timeout: 30_000 })
        .catch(() => {});
      await page
        .evaluate(() => {
          document
            .querySelector('[data-testid="facility-criteria-checklist"]')
            ?.scrollIntoView({ block: 'center' });
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_09_incident_hiyarihatto',
    targetImage: 'images/P1/p1_09_incident_hiyarihatto.png',
    route: '/admin/incidents',
    setup: async (page) => {
      // 記録一覧カード(seed 4件)の描画を待つ
      await page
        .waitForSelector('[data-testid="incident-record-list"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_10_report_template_editor',
    targetImage: 'images/P1/p1_10_report_template_editor.png',
    route: '/admin/document-templates',
    setup: async (page) => {
      // 文面3カラムエディタの描画を待ち、セクションへスクロール
      await page
        .waitForSelector('[data-testid="template-body-editor"]', { timeout: 30_000 })
        .catch(() => {});
      await page
        .evaluate(() => {
          document
            .querySelector('[data-testid="template-body-editor"]')
            ?.scrollIntoView({ block: 'center' });
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_11_voice_memo_transcription',
    targetImage: 'images/P1/p1_11_voice_memo_transcription.png',
    // 田中一郎の当日訪問(seed-design-demo 固定 ID)の音声メモ・文字起こし。
    // STT は外部サービス接続後(cc:blocked)のため、dev 限定 window フックで
    // 転写済み状態(target の例文+01:23)を注入して撮影する。
    route: '/visits/cmnhdemovis001amq9ph-os/voice-memo',
    setup: async (page) => {
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedVoiceMemoDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (
            window as unknown as { __phosSeedVoiceMemoDemo?: () => void }
          ).__phosSeedVoiceMemoDemo?.(),
        )
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="voice-memo-transcript-text"]', { timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_12_advanced_route_scenario_compare',
    targetImage: 'images/P1/p1_12_advanced_route_scenario_compare.png',
    route: '/schedules/route-compare',
    setup: async (page) => {
      // 本日の訪問予定 fetch 完了 → 3 案カードの描画を待つ
      await page
        .waitForSelector('[data-testid="route-scenario-card"]', { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_13_realtime_collaboration_presence',
    targetImage: 'images/P1/p1_13_realtime_collaboration_presence.png',
    // prisma/seed-design-demo.ts の田中一郎カードの連携ビュー(今だれが見ているか)
    route: '/patients/cmnhdemopt001amq9ph-os/collaboration',
    setup: async (page) => {
      // dev 限定の window フックで target と同じ presence 3 人+コメント 3 件を注入
      await page
        .waitForFunction(
          () =>
            typeof (window as unknown as Record<string, unknown>).__phosSeedPresenceDemo ===
            'function',
          undefined,
          { timeout: 30_000 },
        )
        .catch(() => {});
      await page
        .evaluate(() =>
          (window as unknown as { __phosSeedPresenceDemo?: () => void }).__phosSeedPresenceDemo?.(),
        )
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="presence-user-card"]', { timeout: 20_000 })
        .catch(() => {});
      await page
        .waitForSelector('[data-testid="collaboration-demo-comments"]', { timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
  {
    screenId: 'p1_14_ai_signal_tuning',
    targetImage: 'images/P1/p1_14_ai_signal_tuning.png',
    route: '/admin/alert-rules',
    setup: async (page) => {
      // 表示設定パネルの描画を待ち、セクションへスクロール
      await page
        .waitForSelector('[data-testid="signal-tuning-panel"]', { timeout: 30_000 })
        .catch(() => {});
      // target は一部項目が「強く表示」: 腎機能・飲み合わせ・ハイリスクをON(UI 状態のみ、保存しない)
      await page
        .getByTestId('signal-tuning-item')
        .filter({ hasText: '腎機能に注意' })
        .getByRole('button')
        .click()
        .catch(() => {});
      await page
        .getByTestId('signal-tuning-item')
        .filter({ hasText: '飲み合わせ' })
        .getByRole('button')
        .click()
        .catch(() => {});
      await page
        .getByTestId('signal-tuning-item')
        .filter({ hasText: 'ハイリスク薬' })
        .getByRole('button')
        .click()
        .catch(() => {});
      await page
        .evaluate(() => {
          document
            .querySelector('[data-testid="signal-tuning-panel"]')
            ?.scrollIntoView({ block: 'center' });
        })
        .catch(() => {});
      await page.waitForTimeout(400);
    },
  },
];

/** DESIGN_SCREEN_IDS=p0_07,p0_08 のようにカンマ区切りで撮影対象を絞る */
export function filterScreens(entries: DesignScreenEntry[]): DesignScreenEntry[] {
  const raw = process.env.DESIGN_SCREEN_IDS;
  if (!raw) return entries;
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.length === 0) return entries;
  return entries.filter((entry) =>
    wanted.some((w) => entry.screenId === w || entry.screenId.startsWith(w)),
  );
}
