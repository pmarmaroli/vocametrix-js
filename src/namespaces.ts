/**
 * Ergonomic namespace classes exposed on VocametrixClient.
 *
 * Each namespace hides upload patterns, case-style differences, SSE auth quirks,
 * and the start_sec=0 falsy bug from callers.
 */

import {
  AudioInput,
  fetchWithRetry,
  uploadAssignFileId,
  uploadBlobUrl,
  sseStream,
  SseEvent,
} from "./_http.js";
import { VocametrixServerError } from "./exceptions.js";
import type {
  GetCalculateAvqiResponses,
  GetCalculateDsiResponses,
  GetCalculateCppResponses,
  GetCalculateHnrMultibandResponses,
  GetJitterShimmerResponses,
  GetCalculateAmbitusResponses,
  PostPronunciationAssessmentResponses,
  PostTextToSpeechResponses,
  PostAnalyzePhonemesLiveResponses,
  GetTherapyResultBySessionIdResponses,
  GetCalculateProsodySimilarityResponses,
  GetGemapsExtractResponses,
  PostSoundLevelResponses,
} from "./_generated/types.gen.js";

export interface TranscriptionEvent {
  status: string;
  progress: number | undefined;
  displayText: string | undefined;
  isTerminalSuccess: boolean;
  isTerminalFailure: boolean;
  raw: SseEvent;
}

function asJson<T>(resp: { json(): Promise<unknown> }): Promise<T> {
  return resp.json() as Promise<T>;
}

function makeTranscriptionEvent(payload: SseEvent): TranscriptionEvent {
  return {
    status: payload.status,
    progress: payload.progress,
    displayText: payload.displayText,
    isTerminalSuccess: payload.status === "Succeeded",
    isTerminalFailure: ["failed", "error"].includes(payload.status.toLowerCase()),
    raw: payload,
  };
}

export class AvqiNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async calculate(
    sustainedVowel: AudioInput,
    connectedSpeech?: AudioInput,
  ): Promise<GetCalculateAvqiResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, sustainedVowel, this.email);
    const params = new URLSearchParams({ svFileId: svId });
    if (connectedSpeech !== undefined) {
      const csId = await uploadAssignFileId(this.baseUrl, this.authHeaders, connectedSpeech, this.email);
      params.set("csFileId", csId);
    }
    const resp = await fetchWithRetry(`${this.baseUrl}/api/calculate-avqi?${params.toString()}`, {
      headers: this.authHeaders,
    });
    return asJson<GetCalculateAvqiResponses[200]>(resp);
  }
}

export class DsiNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async calculate(sustainedVowel: AudioInput): Promise<GetCalculateDsiResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, sustainedVowel, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/calculate-dsi?svFileId=${svId}`,
      { headers: this.authHeaders },
    );
    return asJson<GetCalculateDsiResponses[200]>(resp);
  }
}

export class CppNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async calculate(sustainedVowel: AudioInput): Promise<GetCalculateCppResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, sustainedVowel, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/calculate-cpp?svFileId=${svId}`,
      { headers: this.authHeaders },
    );
    return asJson<GetCalculateCppResponses[200]>(resp);
  }
}

export class HnrNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async calculate(
    sustainedVowel: AudioInput,
    gender: 1 | 2 = 1,
  ): Promise<GetCalculateHnrMultibandResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, sustainedVowel, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/calculate-hnr-multiband?svFileId=${svId}&gender=${String(gender)}`,
      { headers: this.authHeaders },
    );
    return asJson<GetCalculateHnrMultibandResponses[200]>(resp);
  }
}

export class JitterShimmerNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async calculate(sustainedVowel: AudioInput): Promise<GetJitterShimmerResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, sustainedVowel, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/jitter-shimmer?svFileId=${svId}`,
      { headers: this.authHeaders },
    );
    return asJson<GetJitterShimmerResponses[200]>(resp);
  }
}

export class VrpNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async calculate(
    sustainedVowel: AudioInput,
    age = 30,
    gender: 1 | 2 = 1,
  ): Promise<GetCalculateAmbitusResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, sustainedVowel, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/calculate-ambitus?svFileId=${svId}&age=${String(age)}&gender=${String(gender)}`,
      { headers: this.authHeaders },
    );
    return asJson<GetCalculateAmbitusResponses[200]>(resp);
  }
}

export class PronunciationNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
  ) {}

  async assess(
    audio: AudioInput,
    referenceText: string,
    locale = "en-US",
  ): Promise<PostPronunciationAssessmentResponses[200]> {
    const blobURL = await uploadBlobUrl(this.baseUrl, this.authHeaders, audio);
    const resp = await fetchWithRetry(`${this.baseUrl}/api/pronunciation-assessment`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ blobURL, referenceText, locale }),
    });
    return asJson<PostPronunciationAssessmentResponses[200]>(resp);
  }
}

export class TranscriptionNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly apiKey: string,
  ) {}

  async *stream(
    audio: AudioInput,
    locale = "en-US",
  ): AsyncGenerator<TranscriptionEvent> {
    const blobUrl = await uploadBlobUrl(this.baseUrl, this.authHeaders, audio);
    const resp = await fetchWithRetry(`${this.baseUrl}/api/offline-speech-to-text`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl, locale }),
    });
    const { transcriptionId } = (await resp.json()) as { transcriptionId: string };

    for await (const payload of sseStream(this.baseUrl, transcriptionId, this.apiKey)) {
      yield makeTranscriptionEvent(payload);
    }
  }
}

export class TtsNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
  ) {}

  async synthesize(
    text: string,
    locale = "en-US",
    voiceName?: string,
  ): Promise<PostTextToSpeechResponses[200]> {
    const body: Record<string, string> = { text, locale };
    if (voiceName) body["voiceName"] = voiceName;
    const resp = await fetchWithRetry(`${this.baseUrl}/api/text-to-speech`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return asJson<PostTextToSpeechResponses[200]>(resp);
  }
}

export class PhonemeNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async detect(
    audio: AudioInput,
    language = "fr",
  ): Promise<PostAnalyzePhonemesLiveResponses[200]> {
    const fileId = await uploadAssignFileId(this.baseUrl, this.authHeaders, audio, this.email);
    const resp = await fetchWithRetry(`${this.baseUrl}/api/classify-phoneme`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, language }),
    });
    return asJson<PostAnalyzePhonemesLiveResponses[200]>(resp);
  }
}

export class StutteringNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async classify(
    audio: AudioInput,
    pollIntervalMs = 5000,
    timeoutMs = 620_000,
  ): Promise<GetTherapyResultBySessionIdResponses[200]> {
    const fileId = await uploadAssignFileId(this.baseUrl, this.authHeaders, audio, this.email);
    const startResp = await fetchWithRetry(`${this.baseUrl}/api/classify-stuttering`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    const { session_id: sessionId } = (await startResp.json()) as { session_id: string };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const statusResp = await fetchWithRetry(
        `${this.baseUrl}/api/therapy-status/${sessionId}`,
        { headers: this.authHeaders },
      );
      const statusBody = (await statusResp.json()) as Record<string, string>;
      const state = statusBody["status"] ?? statusBody["state"] ?? "";
      if (["completed", "succeeded", "done"].includes(state)) break;
      if (["failed", "error"].includes(state)) {
        throw new VocametrixServerError(`Stuttering classification failed: ${JSON.stringify(statusBody)}`);
      }
    }

    const resultResp = await fetchWithRetry(
      `${this.baseUrl}/api/therapy-result/${sessionId}`,
      { headers: this.authHeaders },
    );
    return asJson<GetTherapyResultBySessionIdResponses[200]>(resultResp);
  }
}

export class ProsodyNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async similarity(
    model: AudioInput,
    learner: AudioInput,
  ): Promise<GetCalculateProsodySimilarityResponses[200]> {
    const svId = await uploadAssignFileId(this.baseUrl, this.authHeaders, model, this.email);
    const csId = await uploadAssignFileId(this.baseUrl, this.authHeaders, learner, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/calculate-prosody-similarity?svFileId=${svId}&csFileId=${csId}`,
      { headers: this.authHeaders },
    );
    return asJson<GetCalculateProsodySimilarityResponses[200]>(resp);
  }
}

export class EgemapsNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly email: string,
  ) {}

  async extract(audio: AudioInput): Promise<GetGemapsExtractResponses[200]> {
    const fileId = await uploadAssignFileId(this.baseUrl, this.authHeaders, audio, this.email);
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/gemaps-extract?svFileId=${fileId}`,
      { headers: this.authHeaders },
    );
    return asJson<GetGemapsExtractResponses[200]>(resp);
  }
}

export class SoundLevelNamespace {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: Record<string, string>,
  ) {}

  async measure(
    audio: AudioInput,
    startSec = 0,
    endSec?: number,
  ): Promise<PostSoundLevelResponses[200]> {
    // start_sec=0 is treated as falsy by the backend
    if (startSec === 0) {
      console.warn(
        "startSec=0 is treated as falsy by the backend; using 0.001 instead. " +
        "Pass startSec=0.001 explicitly to suppress this warning.",
      );
      startSec = 0.001;
    }

    const blobURL = await uploadBlobUrl(this.baseUrl, this.authHeaders, audio);
    const body: Record<string, unknown> = { blobURL, start_sec: startSec };
    if (endSec !== undefined) body["end_sec"] = endSec;
    const resp = await fetchWithRetry(`${this.baseUrl}/api/soundLevel`, {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return asJson<PostSoundLevelResponses[200]>(resp);
  }
}
