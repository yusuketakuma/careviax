import { type Metadata } from 'next';
import { DocumentTemplateContent } from './template-content';

export const metadata: Metadata = {
  title: '文書テンプレート管理 — CareViaX',
};

export default function DocumentTemplatesPage() {
  return <DocumentTemplateContent />;
}
