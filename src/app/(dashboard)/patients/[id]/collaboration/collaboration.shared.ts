import type { PresenceUser } from '@/components/features/collaboration/presence-avatars';
import type { PatientWorkspaceActivity } from '../patient-detail.types';

/**
 * p1_13 今だれが見ているか(design/images/P1/p1_13_realtime_collaboration_presence.png)。
 * presence(/api/presence patient エンティティ)と直近の動き(overview.workspace.recent_activities)を
 * 「同じカードを見ている人」「コメント・確認」の表示形へ射影する純関数群。
 */

/** presence のエンティティ種別(患者カード単位) */
export const PATIENT_PRESENCE_ENTITY_TYPE = 'patient';

/** 同じカードを見ている人: 1 人分の表示 */
export type CollaborationPresenceView = {
  userId: string;
  displayName: string;
  /** 滞在場所ラベル。例: 処方タブ / 送付先確認 / 報告書 */
  locationLabel: string;
};

/** コメント・確認: 1 件分の表示(「名前:文」形式) */
export type CollaborationCommentView = {
  id: string;
  author: string;
  text: string;
};

export type CollaborationDemoData = {
  presence: CollaborationPresenceView[];
  comments: CollaborationCommentView[];
};

/** active_field(滞在場所キー)→ 日本語ラベル。未知のキーは「閲覧中」に丸める */
const PRESENCE_LOCATION_LABELS: Record<string, string> = {
  card: 'カード',
  collaboration: '連携ビュー',
  profile: '患者プロフィール',
  prescriptions: '処方タブ',
  delivery: '送付先確認',
  report: '報告書',
};

export function presenceLocationLabel(activeField: string | null): string {
  if (!activeField) return '閲覧中';
  return PRESENCE_LOCATION_LABELS[activeField] ?? '閲覧中';
}

/**
 * presence 一覧を表示形へ射影する。
 * - 自分自身は除外(「同じカードを見ている"他の"人」のため)
 * - 先に開いていた人から順に表示(updated_at 昇順、同時刻は名前順で安定化)
 */
export function buildPresenceViews(
  users: PresenceUser[],
  selfUserId?: string | null,
): CollaborationPresenceView[] {
  return users
    .filter((user) => !selfUserId || user.user_id !== selfUserId)
    .sort(
      (a, b) =>
        a.updated_at.localeCompare(b.updated_at) || a.display_name.localeCompare(b.display_name),
    )
    .map((user) => ({
      userId: user.user_id,
      displayName: user.display_name,
      locationLabel: presenceLocationLabel(user.active_field),
    }));
}

/** コメントとして表示する直近の動きの最大件数 */
export const COLLABORATION_COMMENT_LIMIT = 6;

/** actor が無い動きの「名前」フォールバック(06_card の種別ラベルに合わせる) */
const ACTIVITY_FALLBACK_AUTHORS: Record<PatientWorkspaceActivity['type'], string> = {
  transition: '工程',
  inquiry: '照会',
  intake: '取込',
};

/**
 * 直近の動き(recent_activities)を「名前:文」のコメント形へ射影する。
 * 新しいものから最大 COLLABORATION_COMMENT_LIMIT 件。
 */
export function buildCollaborationComments(
  activities: PatientWorkspaceActivity[],
): CollaborationCommentView[] {
  return [...activities]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, COLLABORATION_COMMENT_LIMIT)
    .map((activity) => ({
      id: activity.id,
      author: activity.actor?.trim() || ACTIVITY_FALLBACK_AUTHORS[activity.type],
      text: activity.label,
    }));
}

/**
 * 撮影・動作確認用デモデータ(dev 限定 window フック __phosSeedPresenceDemo から使用)。
 * target デザイン p1_13 の 3 人+コメント 3 件を再現する。
 */
export function buildCollaborationDemoData(): CollaborationDemoData {
  return {
    presence: [
      { userId: 'demo-presence-sato', displayName: '佐藤薬剤師', locationLabel: '処方タブ' },
      { userId: 'demo-presence-suzuki', displayName: '鈴木事務', locationLabel: '送付先確認' },
      { userId: 'demo-presence-takahashi', displayName: '高橋薬剤師', locationLabel: '報告書' },
    ],
    comments: [
      { id: 'demo-comment-1', author: '佐藤', text: '粉砕可否を確認中です' },
      { id: 'demo-comment-2', author: '鈴木', text: 'ケアマネFAXを登録しました' },
      { id: 'demo-comment-3', author: '高橋', text: '報告書は下書き保存済みです' },
    ],
  };
}
