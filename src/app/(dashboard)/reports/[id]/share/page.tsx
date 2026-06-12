'use client';

import { useParams } from 'next/navigation';
import { InterprofessionalShareContent } from './interprofessional-share-content';

/**
 * p1_05「他職種向け共有ページ」(/reports/[id]/share)。
 * 報告・文書文脈の配下で、共有する相手 / 相手に見える内容 / 返信・確認を 3 カラム表示する。
 */
export default function ReportInterprofessionalSharePage() {
  const { id } = useParams<{ id: string }>();
  return <InterprofessionalShareContent reportId={id} />;
}
