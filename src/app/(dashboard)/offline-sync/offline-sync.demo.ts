'use client';

import { offlineDb } from '@/lib/stores/offline-db';
import { enqueueForSync, registerVisitRecordConflict } from '@/lib/stores/sync-engine';

type OfflineSyncDemoMode = 'queue' | 'conflict';

/**
 * p0_34/p0_35 撮影・動作確認用のデモデータ注入(dev 限定で window に公開)。
 * p0_34 は一覧4行、p0_35 は競合解決ビュー用の409行に分けて作る。
 */
export async function seedOfflineSyncDemoData(mode: OfflineSyncDemoMode = 'conflict') {
  await offlineDb.syncQueue.clear();

  if (mode === 'queue') {
    await enqueueForSync('visit_record', {
      display_kind: '一時保存',
      display_status: '同期済み',
      display_next_action: '完了',
      schedule_id: 'demo-sync-temp-1',
      patient_id: '鈴木次郎',
      visit_date: '2026-06-12',
      outcome_status: 'completed',
      soap_subjective: '一時保存済み。',
    });

    await enqueueForSync('visit_record', {
      display_kind: '写真',
      display_status: '失敗',
      display_next_action: '再試行',
      schedule_id: 'demo-sync-photo-2',
      patient_id: '佐藤花子',
      visit_date: '2026-06-12',
      outcome_status: 'completed',
      soap_subjective: '残薬写真を保存。',
    });
    const failedPhoto = await offlineDb.syncQueue.orderBy('createdAt').reverse().first();
    if (failedPhoto?.id) {
      await offlineDb.syncQueue.update(failedPhoto.id, {
        retryCount: 3,
        lastError: 'HTTP 500',
      });
    }

    await enqueueForSync('visit_record', {
      display_kind: '訪問メモ',
      display_status: '同期待ち',
      display_next_action: 'そのまま',
      schedule_id: 'demo-sync-note-1',
      patient_id: '田中一郎',
      visit_date: '2026-06-12',
      outcome_status: 'completed',
      soap_subjective: '夕食後薬は家族声かけで服用。',
    });

    await enqueueForSync('visit_record', {
      display_kind: '写真',
      display_status: '未同期',
      display_next_action: '再試行',
      schedule_id: 'demo-sync-photo-1',
      patient_id: '田中一郎',
      visit_date: '2026-06-12',
      outcome_status: 'completed',
      soap_subjective: '残薬写真を保存。',
    });
    return;
  }

  // 同期待ち(訪問メモ)
  await enqueueForSync('visit_record', {
    schedule_id: 'demo-sync-sched-1',
    patient_id: '田中一郎',
    visit_date: '2026-06-12',
    outcome_status: 'completed',
    soap_subjective: '夕食後薬は家族声かけで服用。',
  });

  // 失敗(残薬調整) — リトライ上限に到達した状態を再現
  await enqueueForSync('residual_medication', {
    patient_id: '佐藤花子',
    drug_name: 'アムロジピン錠5mg',
    remaining_quantity: 6,
  });
  const failedItem = await offlineDb.syncQueue.orderBy('createdAt').reverse().first();
  if (failedItem?.id) {
    await offlineDb.syncQueue.update(failedItem.id, {
      retryCount: 3,
      lastError: 'HTTP 500',
    });
  }

  // 競合(他のスタッフがサーバー側を更新済み)
  await registerVisitRecordConflict({
    scheduleId: 'demo-sync-sched-2',
    payload: {
      schedule_id: 'demo-sync-sched-2',
      patient_id: '鈴木次郎',
      visit_date: '2026-06-12',
      outcome_status: 'completed',
      soap_subjective: '夕食後薬は家族声かけで服用。',
    },
    server: {
      id: 'demo-sync-server-record',
      version: 2,
      patient_id: '鈴木次郎',
      visit_date: '2026-06-12',
      outcome_status: 'completed',
      // normalizeConflictServer は SOAP/次回提案日のキー欠落(undefined)を弾くため null を明示する
      soap_subjective: '夕食後薬は家族声かけで服用。便秘あり。',
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      next_visit_suggestion_date: null,
    },
  });
}
