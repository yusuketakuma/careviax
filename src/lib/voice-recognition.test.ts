import { afterEach, describe, expect, it } from 'vitest';
import {
  appendVoiceTranscript,
  extractSpeechTranscript,
  formatSpeechTranscriptForSoap,
  getSpeechRecognitionConstructor,
} from '@/lib/voice-recognition';

describe('voice recognition utilities', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('returns SpeechRecognition constructor when available', () => {
    class MockSpeechRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
    }

    Object.defineProperty(globalThis, 'window', {
      value: {
        SpeechRecognition: MockSpeechRecognition,
      },
      configurable: true,
      writable: true,
    });

    expect(getSpeechRecognitionConstructor()).toBe(MockSpeechRecognition);
  });

  it('returns null when speech recognition is unavailable', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(getSpeechRecognitionConstructor()).toBeNull();
  });

  it('extracts final and interim transcripts separately', () => {
    const transcript = extractSpeechTranscript({
      resultIndex: 0,
      results: {
        0: {
          0: { transcript: '服薬は良好です' },
          isFinal: true,
          length: 1,
        },
        1: {
          0: { transcript: '血圧も安定' },
          isFinal: false,
          length: 1,
        },
        length: 2,
      },
    });

    expect(transcript.finalText).toBe('服薬は良好です');
    expect(transcript.interimText).toBe('血圧も安定');
  });

  it('appends recognized text as a new line when a value already exists', () => {
    expect(appendVoiceTranscript('', '朝は問題なし')).toBe('朝は問題なし');
    expect(appendVoiceTranscript('副作用なし', '食欲も安定')).toBe(
      '副作用なし\n食欲も安定'
    );
  });

  it('formats recognized japanese speech for SOAP textareas', () => {
    expect(formatSpeechTranscriptForSoap('服薬は良好です')).toBe('服薬は良好です。');
    expect(formatSpeechTranscriptForSoap('食欲は安定, 睡眠も良好')).toBe(
      '食欲は安定、睡眠も良好。'
    );
    expect(formatSpeechTranscriptForSoap('痛みなし。')).toBe('痛みなし。');
  });
});
