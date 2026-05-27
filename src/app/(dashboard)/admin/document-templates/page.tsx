import { type Metadata } from 'next';
import { DocumentTemplateContent } from './template-content';

export const metadata: Metadata = {
  title: '文書テンプレート管理 — PH-OS',
};

export default function DocumentTemplatesPage() {
  return <DocumentTemplateContent />;
}
