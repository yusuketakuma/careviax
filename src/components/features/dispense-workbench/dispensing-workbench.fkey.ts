import type { CellTarget, FKeyAction, Phase } from './dispensing-workbench.types';

/**
 * dispatchFKeyAction が必要とする副作用群。
 * runAction（dispensing-workbench.tsx）が store / router / writeHandlers の実体を束ねて渡す。
 */
export interface FKeyActionDeps {
  /** 患者リボン送り（-1 前 / +1 次）。 */
  navBy: (delta: number) => void;
  /** 一括（調剤一括 done / 監査一括 / セット一括）。 */
  onBulk: () => void;
  /** 保留モーダルを現在セルで開く。 */
  openHold: (target: CellTarget | null) => void;
  /** 工程ルートへ遷移する。 */
  pushPhase: (phase: Phase) => void;
  /** 次工程へ進む primary。遷移先 Phase を返す（null=遷移しない / confirm 要求）。 */
  onPrimary: () => Phase | null;
  /** hold 対象セル。 */
  target: CellTarget | null;
}

/**
 * F-key アクションの純粋ディスパッチャ。
 *
 * 不可逆 sign-off（調剤完了 / 監査承認 / セット監査承認）またはセット監査 reject の
 * 確認ダイアログ表示中は hasPendingConfirm=true で **すべての** アクションを無効化する
 * （switch より前で一括 return）。これにより確認中の患者文脈ドリフト
 * （prevPatient/nextPatient/bulk/hold）や工程 churn を抑止する。
 *
 * runAction の switch をこの純粋関数へ抽出することで、確認中に新たなアクションが
 * ガードより前へ漏れる回帰を table-test で機械的に検出できる。
 *
 * @returns ディスパッチした場合 true（確認中ブロックや未知アクションは false）。
 */
export function dispatchFKeyAction(
  action: FKeyAction,
  hasPendingConfirm: boolean,
  deps: FKeyActionDeps,
): boolean {
  // 確認中は全 F-key を無効化（個別アクションより前に一括停止）。
  if (hasPendingConfirm) return false;
  switch (action) {
    case 'prevPatient':
      deps.navBy(-1);
      return true;
    case 'nextPatient':
      deps.navBy(1);
      return true;
    case 'bulk':
      deps.onBulk();
      return true;
    case 'hold':
      deps.openHold(deps.target);
      return true;
    case 'phaseDispense':
      deps.pushPhase('dispense');
      return true;
    case 'phaseAudit':
      deps.pushPhase('audit');
      return true;
    case 'phaseSet':
      deps.pushPhase('setp');
      return true;
    case 'phaseSetAudit':
      deps.pushPhase('seta');
      return true;
    case 'next': {
      const nextPhase = deps.onPrimary();
      if (nextPhase) deps.pushPhase(nextPhase);
      return true;
    }
    default:
      return false;
  }
}
