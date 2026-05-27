'use client';

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { cn } from '@/lib/utils';
import { CursorOverlay } from './cursor-overlay';

interface CollaborativeTextareaProps {
  yText: Y.Text;
  awareness: Awareness;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange?: (value: string, meta: { local: boolean }) => void;
}

/**
 * A textarea that binds to a Yjs Y.Text for collaborative character-level editing.
 * Remote cursors and selections are rendered via CursorOverlay using Awareness data.
 */
export function CollaborativeTextarea({
  yText,
  awareness,
  placeholder,
  className,
  disabled,
  id,
  onValueChange,
}: CollaborativeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isLocalChange = useRef(false);

  // Sync Y.Text -> textarea
  const syncFromYjs = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || isLocalChange.current) return;

    const currentValue = textarea.value;
    const yjsValue = yText.toString();

    if (currentValue !== yjsValue) {
      const { selectionStart, selectionEnd } = textarea;
      textarea.value = yjsValue;
      // Restore cursor position as best we can
      textarea.selectionStart = Math.min(selectionStart, yjsValue.length);
      textarea.selectionEnd = Math.min(selectionEnd, yjsValue.length);
      onValueChange?.(yjsValue, { local: false });
    }
  }, [onValueChange, yText]);

  // Observe Y.Text changes (remote edits)
  useEffect(() => {
    syncFromYjs();
    yText.observe(syncFromYjs);
    return () => yText.unobserve(syncFromYjs);
  }, [yText, syncFromYjs]);

  // Handle local input -> Y.Text
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const newValue = textarea.value;
      const oldValue = yText.toString();

      if (newValue === oldValue) return;

      isLocalChange.current = true;
      try {
        // Find the diff range and apply minimal Yjs operations
        let start = 0;
        while (
          start < oldValue.length &&
          start < newValue.length &&
          oldValue[start] === newValue[start]
        ) {
          start++;
        }

        let oldEnd = oldValue.length;
        let newEnd = newValue.length;
        while (
          oldEnd > start &&
          newEnd > start &&
          oldValue[oldEnd - 1] === newValue[newEnd - 1]
        ) {
          oldEnd--;
          newEnd--;
        }

        const deleteCount = oldEnd - start;
        const insertText = newValue.slice(start, newEnd);

        yText.doc?.transact(() => {
          if (deleteCount > 0) {
            yText.delete(start, deleteCount);
          }
          if (insertText.length > 0) {
            yText.insert(start, insertText);
          }
        });
        onValueChange?.(newValue, { local: true });
      } finally {
        isLocalChange.current = false;
      }
    },
    [onValueChange, yText],
  );

  // Broadcast cursor position via Awareness
  const handleSelectionChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const localState = awareness.getLocalState();
    if (!localState) return;

    awareness.setLocalStateField('cursor', {
      anchor: textarea.selectionStart,
      head: textarea.selectionEnd,
    });
  }, [awareness]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onInput={handleInput}
        onSelect={handleSelectionChange}
        onFocus={handleSelectionChange}
      />
      <CursorOverlay awareness={awareness} />
    </div>
  );
}
