'use client';

import { offlineDb } from '@/lib/stores/offline-db';
import { enqueueForSync, registerVisitRecordConflict } from '@/lib/stores/sync-engine';

/**
 * p0_34/p0_35 撮影・動作確認用のデモデータ注入(dev 限定で window に公開)。
 * 同期待ち / 失敗 / 競合の3状態を同期キューに作る。
 */
export async function seedOfflineSyncDemoData() {
  await offlineDb.syncQueue.clear();

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
