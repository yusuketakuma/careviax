'use client';

import { useRef } from 'react';
import { FileImage, FileText, Paperclip, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export const VISIT_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export type VisitAttachmentDraft = {
  id: string;
  file: File;
  kind: 'photo' | 'attachment';
};

type VisitAttachmentsFieldProps = {
  disabled?: boolean;
  inputId?: string;
  items: VisitAttachmentDraft[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
};

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)}KB`;
  }

  return `${sizeBytes}B`;
}

export function VisitAttachmentsField({
  disabled = false,
  inputId = 'visit-record-attachments',
  items,
  onAddFiles,
  onRemoveFile,
}: VisitAttachmentsFieldProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = (files: FileList | null) => {
    const nextFiles = files ? Array.from(files) : [];
    if (nextFiles.length > 0) {
      onAddFiles(nextFiles);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={inputId} className="flex items-center gap-1.5">
          <Paperclip className="size-3.5 text-muted-foreground" aria-hidden="true" />
          写真・添付
        </Label>
        <p className="text-xs text-muted-foreground">
          JPEG / PNG / WEBP は 10MB まで、PDF は 50MB まで添付できます。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          id={`${inputId}-camera`}
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          id={inputId}
          ref={fileInputRef}
          type="file"
          accept={VISIT_ATTACHMENT_ACCEPT}
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
        >
          写真を撮影
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          ファイルを選択
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        残薬写真は「写真を撮影」からそのまま追加できます。
      </p>

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item) => {
            const Icon = item.kind === 'photo' ? FileImage : FileText;

            return (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.file.name}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      {item.kind === 'photo' ? '写真' : '添付'}
                    </Badge>
                    <span>{item.file.type || 'application/octet-stream'}</span>
                    <span>{formatFileSize(item.file.size)}</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={disabled}
                  onClick={() => onRemoveFile(item.id)}
                  aria-label={`${item.file.name} を削除`}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">添付ファイルはまだ選択されていません。</p>
      )}
    </div>
  );
}
