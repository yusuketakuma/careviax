import { type Metadata } from 'next';
import { DataExplorerContent } from './data-explorer-content';

export const metadata: Metadata = {
  title: 'データ探索 — PH-OS',
};

export default function DataExplorerPage() {
  return <DataExplorerContent />;
}
