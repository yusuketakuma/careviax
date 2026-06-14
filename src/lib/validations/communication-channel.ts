import { z } from 'zod';
import type { CommunicationChannel } from '@prisma/client';

export const COMMUNICATION_CHANNELS = [
  'ph_os_share',
  'email',
  'fax',
  'phone',
  'in_person',
  'postal',
  'ses',
] as const satisfies readonly [CommunicationChannel, ...CommunicationChannel[]];

export const communicationChannelSchema = z.enum(COMMUNICATION_CHANNELS);

/**
 * 自動送信を行わない「記録専用」チャネル。
 *
 * - fax: 本システムは FAX ゲートウェイを持たない。送信処理は実装せず、手動で
 *   送付した事実を記録するだけのチャネルとして扱う（記録専用）。手動 FAX の
 *   実体は郵送（postal）/手渡し（in_person）と同じく人手による送付であり、
 *   いかなるコードパスからも「自動送信」されてはならない。
 * - phone / in_person / postal: いずれも人手による連絡・送付の記録専用。
 *
 * 自動的に成果物を届けられる（deliverable な）チャネルは ph_os_share / email
 * （/ ses）。送付方法の既定はアプリ内共有 ph_os_share を推奨する。
 */
export const RECORD_ONLY_COMMUNICATION_CHANNELS = [
  'fax',
  'phone',
  'in_person',
  'postal',
] as const satisfies readonly CommunicationChannel[];

/** 自動送信が可能（deliverable）なチャネル。送付の既定は ph_os_share。 */
export const DELIVERABLE_COMMUNICATION_CHANNELS = [
  'ph_os_share',
  'email',
  'ses',
] as const satisfies readonly CommunicationChannel[];

/** 送付方法の既定（自動送信可能・推奨）。 */
export const DEFAULT_COMMUNICATION_CHANNEL = 'ph_os_share' as const satisfies CommunicationChannel;

/**
 * 指定チャネルが「記録専用」（自動送信を伴わない）かどうかを判定する。
 * fax を含む手動チャネルはこれで true を返す。呼び出し側は true の場合に
 * 自動送信処理を実行してはならない（手動送付の記録に留める）。
 */
export function isRecordOnlyChannel(
  channel: CommunicationChannel
): channel is (typeof RECORD_ONLY_COMMUNICATION_CHANNELS)[number] {
  return (RECORD_ONLY_COMMUNICATION_CHANNELS as readonly CommunicationChannel[]).includes(channel);
}
