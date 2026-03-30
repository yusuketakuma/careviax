'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  extractSpeechTranscript,
  formatSpeechTranscriptForSoap,
  getSpeechRecognitionConstructor,
  type BrowserSpeechRecognition,
  type SoapVoiceField,
} from '@/lib/voice-recognition';

type UseSpeechRecognitionOptions = {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onTranscript?: (field: SoapVoiceField, transcript: string) => void;
};

function isPermissionDeniedError(error?: string) {
  return error === 'not-allowed' || error === 'service-not-allowed';
}

export function useSpeechRecognition({
  lang = 'ja-JP',
  continuous = true,
  interimResults = true,
  onTranscript,
}: UseSpeechRecognitionOptions = {}) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [activeField, setActiveField] = useState<SoapVoiceField | null>(null);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const Recognition = useMemo(() => getSpeechRecognitionConstructor(), []);
  const isSupported = Boolean(Recognition);
  const isListening = activeField !== null;

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setActiveField(null);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback(
    (field: SoapVoiceField) => {
      if (!Recognition) {
        setError('このブラウザでは音声入力を利用できません');
        return;
      }

      recognitionRef.current?.stop();

      const recognition = new Recognition();
      recognition.lang = lang;
      recognition.continuous = continuous;
      recognition.interimResults = interimResults;

      recognition.onresult = (event) => {
        const { finalText, interimText } = extractSpeechTranscript(event);
        const formattedTranscript = formatSpeechTranscriptForSoap(finalText);

        if (formattedTranscript) {
          setTranscript(formattedTranscript);
          onTranscript?.(field, formattedTranscript);
        }

        setInterimTranscript(interimText);
      };

      recognition.onerror = (event) => {
        if (recognitionRef.current !== recognition) return;

        setError(
          isPermissionDeniedError(event.error)
            ? 'マイク権限が拒否されました。ブラウザ設定で許可してください'
            : '音声入力を継続できませんでした'
        );
        stopListening();
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setActiveField(null);
        setInterimTranscript('');
      };

      try {
        recognition.start();
        recognitionRef.current = recognition;
        setActiveField(field);
        setTranscript('');
        setError(null);
        setInterimTranscript('');
      } catch {
        setError('音声入力を開始できませんでした');
        recognitionRef.current = null;
        setActiveField(null);
        setInterimTranscript('');
      }
    },
    [Recognition, continuous, interimResults, lang, onTranscript, stopListening]
  );

  const toggleListening = useCallback(
    (field: SoapVoiceField) => {
      if (activeField === field) {
        stopListening();
        return;
      }

      startListening(field);
    },
    [activeField, startListening, stopListening]
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    function handleVisibilityChange() {
      if (document.hidden) {
        stopListening();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopListening]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return {
    activeField,
    error,
    interimTranscript,
    isListening,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
    transcript,
  };
}
