// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VoiceSoapAssist } from './voice-soap-assist';

setupDomTestEnv();

describe('VoiceSoapAssist', () => {
  it('shows large visit-time voice capture buttons for each SOAP target', () => {
    const onToggle = vi.fn();

    render(<VoiceSoapAssist activeField={null} isSupported onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /訴えを聞く/ }));

    expect(screen.getByRole('button', { name: /観察を残す/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /評価を残す/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /次回対応を残す/ })).toBeTruthy();
    expect(onToggle).toHaveBeenCalledWith('soap_subjective');
  });

  it('marks the active voice target and disables controls when offline', () => {
    const onToggle = vi.fn();

    render(
      <VoiceSoapAssist
        activeField="soap_objective"
        interimTranscript="残薬はありません"
        isOffline
        isSupported
        onToggle={onToggle}
      />,
    );

    const activeButton = screen.getByRole('button', { name: /O 停止/ });
    expect(activeButton.getAttribute('aria-pressed')).toBe('true');
    expect(activeButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/オフライン時は Web Speech API を利用できません/)).toBeTruthy();
  });
});
