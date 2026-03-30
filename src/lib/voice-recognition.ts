export type SoapVoiceField =
  | 'soap_subjective'
  | 'soap_objective'
  | 'soap_assessment'
  | 'soap_plan';

export type SoapVoiceDraft = {
  targetField: SoapVoiceField;
  transcript: string;
};

export type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type BrowserSupport = {
  desktop: string;
  tablet: string;
  mobile: string;
};

export const SOAP_VOICE_FIELD_LABELS: Record<SoapVoiceField, string> = {
  soap_subjective: 'S',
  soap_objective: 'O',
  soap_assessment: 'A',
  soap_plan: 'P',
};

export function getSpeechRecognitionConstructor():
  | (new () => BrowserSpeechRecognition)
  | null {
  if (typeof window === 'undefined') return null;

  const candidate = (
    window as typeof window & {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }
  ).SpeechRecognition ??
    (
      window as typeof window & {
        SpeechRecognition?: new () => BrowserSpeechRecognition;
        webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
      }
    ).webkitSpeechRecognition;

  return candidate ?? null;
}

export function extractSpeechTranscript(event: SpeechRecognitionEventLike) {
  let finalText = '';
  let interimText = '';

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result[0]?.transcript?.trim() ?? '';
    if (!transcript) continue;

    if (result.isFinal) {
      finalText += `${transcript} `;
    } else {
      interimText += `${transcript} `;
    }
  }

  return {
    finalText: finalText.trim(),
    interimText: interimText.trim(),
  };
}

export function appendVoiceTranscript(currentValue: string, transcript: string) {
  const base = currentValue.trim();
  const addition = transcript.trim();
  if (!addition) return currentValue;
  if (!base) return addition;
  return `${base}\n${addition}`;
}

export function formatSpeechTranscriptForSoap(transcript: string) {
  const normalized = transcript
    .replace(/[，,]+/g, '、')
    .replace(/[．.]+/g, '。')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  const collapsed = normalized.replace(/ ([ぁ-んァ-ヶ一-龠ー])/g, '$1');
  if (/[。！？!?]$/.test(collapsed)) {
    return collapsed;
  }

  return `${collapsed}。`;
}

export function getVoiceInputSupportMatrix(hasSpeechRecognition: boolean): BrowserSupport {
  if (!hasSpeechRecognition) {
    return {
      desktop: '○Chrome/Edge/Safari',
      tablet: '○Safari/Chrome',
      mobile: '△Safari限定',
    };
  }

  return {
    desktop: '◎Chrome/Edge/Safari',
    tablet: '○Safari/Chrome',
    mobile: '△iPhone Safari中心',
  };
}
