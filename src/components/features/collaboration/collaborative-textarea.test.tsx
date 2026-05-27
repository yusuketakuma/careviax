// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { CollaborativeTextarea } from './collaborative-textarea';

function createCollaborationState() {
  const doc = new Y.Doc();
  return {
    doc,
    yText: doc.getText('note'),
    awareness: new Awareness(doc),
  };
}

describe('CollaborativeTextarea', () => {
  it('reports local input changes so React Hook Form can submit collaborative text', () => {
    const { yText, awareness } = createCollaborationState();
    const onValueChange = vi.fn();

    render(
      <CollaborativeTextarea
        yText={yText}
        awareness={awareness}
        onValueChange={onValueChange}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.input(textarea, { target: { value: '冷所保管' } });

    expect(yText.toString()).toBe('冷所保管');
    expect(onValueChange).toHaveBeenCalledWith('冷所保管', { local: true });
  });

  it('reports remote Y.Text changes without marking them as local edits', () => {
    const { yText, awareness } = createCollaborationState();
    const onValueChange = vi.fn();

    render(
      <CollaborativeTextarea
        yText={yText}
        awareness={awareness}
        onValueChange={onValueChange}
      />,
    );

    act(() => {
      yText.insert(0, 'remote note');
    });

    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('remote note');
    expect(onValueChange).toHaveBeenCalledWith('remote note', { local: false });
  });
});
