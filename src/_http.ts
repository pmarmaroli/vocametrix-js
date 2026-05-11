/**
 * Internal HTTP helpers: upload patterns, retry logic, SSE streaming.
 * Never import from _generated inside this module.
 */

import { readFile } from "fs/promises";
import { isRetryable, raiseForStatus, VocametrixServerError } from "./exceptions.js";

export interface AudioPayload {
  data: Buffer | Uint8Array;
  filename?: string;
  contentType?: string;
}

export type AudioInput = string | Buffer | Uint8Array | AudioPayload;

function isAudioPayload(audio: AudioInput): audio is AudioPayload {
  return (
    typeof audio === "object" &&
    audio !== null &&
    !(audio instanceof Uint8Array) &&
    "data" in audio
  );
}

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return retryAfter * 1000;
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

const AUDIO_MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
};

export function audioContentType(audio: AudioInput): string {
  if (isAudioPayload(audio)) {
    return audio.contentType ?? "application/octet-stream";
  }
  if (typeof audio === "string") {
    const dot = audio.lastIndexOf(".");
    if (dot !== -1) {
      const ext = audio.slice(dot).toLowerCase();
      return AUDIO_MIME[ext] ?? "audio/wav";
    }
  }
  return "audio/wav";
}

function audioFilename(audio: AudioInput): string {
  if (isAudioPayload(audio)) {
    return audio.filename ?? "audio.wav";
  }
  if (typeof audio === "string") {
    const slash = Math.max(audio.lastIndexOf("/"), audio.lastIndexOf("\\"));
    return slash !== -1 ? audio.slice(slash + 1) : audio;
  }
  return "audio.wav";
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData | Blob | Uint8Array | null;
  signal?: AbortSignal;
}

export async function fetchWithRetry(
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: options.method ?? "GET",
        ...(options.headers !== undefined && { headers: options.headers }),
        ...(options.body !== undefined && { body: options.body }),
        ...(options.signal !== undefined && { signal: options.signal }),
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (resp.ok) return resp;

    // Non-retryable 4xx — raise immediately (except 429)
    const retryAfterHeader = resp.headers.get("Retry-After");
    const parsed = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
    const retryAfterSec = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    if (!isRetryable(resp.status) || attempt === MAX_RETRIES) {
      let body: unknown;
      try { body = await resp.json(); } catch { body = await resp.text(); }
      raiseForStatus(resp.status, body, retryAfterSec);
    }

    // Retryable — back off
    const wait = backoffMs(attempt, retryAfterSec);
    await sleep(wait);
  }
  // TypeScript control-flow guard: the loop always returns or throws before this point.
  throw new VocametrixServerError("Max retries exceeded");
}

// ── Upload helpers ─────────────────────────────────────────────────────────

async function readAudio(audio: AudioInput): Promise<Buffer> {
  if (isAudioPayload(audio)) {
    return audio.data instanceof Buffer ? audio.data : Buffer.from(audio.data);
  }
  if (typeof audio === "string") return readFile(audio);
  if (audio instanceof Buffer) return audio;
  return Buffer.from(audio);
}

export async function uploadAssignFileId(
  baseUrl: string,
  authHeaders: Record<string, string>,
  audio: AudioInput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _email?: string, // deprecated, ignored — kept for back-compat
): Promise<string> {
  const data = await readAudio(audio);
  const contentType = audioContentType(audio);
  const filename = audioFilename(audio);
  const form = new FormData();
  form.append("audio", new Blob([data], { type: contentType }), filename);
  // The `email` form field is deprecated. The backend now keys usage-tracking
  // opt-out on the API key (server-controlled list); the SDK no longer sends
  // this field. The `_email` parameter is retained for backward compatibility
  // with callers that still pass it.

  const resp = await fetchWithRetry(`${baseUrl}/api/assignFileId`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });
  const json = (await resp.json()) as { fileId?: unknown };
  if (typeof json.fileId !== "string") {
    throw new VocametrixServerError(
      `assignFileId response missing 'fileId' (got ${JSON.stringify(json)})`,
    );
  }
  return json.fileId;
}

export async function uploadBlobUrl(
  baseUrl: string,
  authHeaders: Record<string, string>,
  audio: AudioInput,
): Promise<string> {
  const resp = await fetchWithRetry(`${baseUrl}/api/get-blob-url`, {
    method: "POST",
    headers: authHeaders,
  });
  const parsed = (await resp.json()) as { uploadURL?: unknown; blobURL?: unknown };
  if (typeof parsed.uploadURL !== "string" || typeof parsed.blobURL !== "string") {
    throw new VocametrixServerError(
      `get-blob-url response missing 'uploadURL' or 'blobURL' (got ${JSON.stringify(parsed)})`,
    );
  }
  const { uploadURL, blobURL } = parsed as { uploadURL: string; blobURL: string };

  const data = await readAudio(audio);
  const contentType = audioContentType(audio);

  // Retry the Azure PUT with the same backoff strategy as fetchWithRetry,
  // but keep raw fetch so we can surface the x-ms-request-id on failure.
  let put: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      put = await fetch(uploadURL, {
        method: "PUT",
        body: data,
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType },
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new VocametrixServerError(`Azure upload network error: ${String(err)}`);
      }
      await sleep(backoffMs(attempt));
      continue;
    }
    if (put.ok) return blobURL;
    const transient = put.status === 429 || put.status >= 500;
    if (!transient || attempt === MAX_RETRIES) {
      const errText = await put.text();
      const reqId = put.headers.get("x-ms-request-id") ?? "n/a";
      throw new VocametrixServerError(
        `Azure upload failed: ${String(put.status)} (x-ms-request-id=${reqId}) ${errText}`,
      );
    }
    await sleep(backoffMs(attempt));
  }
  throw new VocametrixServerError("Azure upload: max retries exceeded");
}

// ── SSE streaming ──────────────────────────────────────────────────────────

export interface SseEvent {
  status: string;
  progress?: number;
  displayText?: string;
  [key: string]: unknown;
}

export async function* sseStream(
  baseUrl: string,
  transcriptionId: string,
  apiKey: string,
): AsyncGenerator<SseEvent> {
  const url = `${baseUrl}/api/transcription-progress/${transcriptionId}`;
  const resp = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!resp.ok || !resp.body) {
    let body: unknown;
    try { body = await resp.json(); } catch { body = resp.statusText; }
    raiseForStatus(resp.status, body);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const chunk = await reader.read() as { done: boolean; value: Uint8Array | undefined };
      if (chunk.done) break;
      const value = chunk.value ?? new Uint8Array(0);
      buffer += decoder.decode(value, { stream: true });

      // Normalise CRLF so both \n\n and \r\n\r\n are handled uniformly
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const eventText = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        // Collect ALL data: lines (SSE spec: multiple data lines joined with \n)
        const dataLines = eventText
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart());

        if (dataLines.length > 0) {
          const raw = dataLines.join("\n");
          try {
            yield JSON.parse(raw) as SseEvent;
          } catch {
            // skip malformed events
          }
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
