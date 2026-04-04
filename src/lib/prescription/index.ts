/**
 * 処方登録ドメイン
 *
 * 責務: 処方箋の電子化（非薬剤師スタッフが操作）
 * - PrescriptionIntake / PrescriptionLine の作成・編集
 * - 処方変更検出（medication-diff）
 * - 処方登録完了で調剤ドラフトを自動生成（→ dispense-draft-service）
 *
 * パッケージング・セット系ロジックは src/lib/dispensing/ に統合済み。
 * 旧パスの re-export スタブは後方互換のため残存。
 */
export {
  detectMedicationChanges,
  prescriptionLineKey,
  type MedicationChange,
} from './medication-diff';
