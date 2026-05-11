/**
 * Internal HTTP helpers: upload patterns, retry logic, SSE streaming.
 * Never import from _generated inside this module.
 */

import { readFileSync } from "fs";
import { isRetryable, raiseForStatus, VocametrixServerError } from "./exceptions.js";

export type AudioInput = string | Buffer | Uint8Array;

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return retryAfter * 1000;
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
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
    const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader) : undefined;
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

function readAudio(audio: AudioInput): Buffer {
  if (typeof audio === "string") return readFileSync(audio);
  if (audio instanceof Buffer) return audio;
  return Buffer.from(audio);
}

export async function uploadAssignFileId(
  baseUrl: string,
  authHeaders: Record<string, string>,
  audio: AudioInput,
  email = "sdk@vocametrix.com",
): Promise<string> {
  const data = readAudio(audio);
  const form = new FormData();
  form.append("audio", new Blob([data], { type: "audio/wav" }), "audio.wav");
  form.append("email", email);

  const resp = await fetchWithRetry(`${baseUrl}/api/assignFileId`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });
  const json = (await resp.json()) as { fileId: string };
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
  const { uploadURL, blobURL } = (await resp.json()) as {
    uploadURL: string;
    blobURL: string;
  };

  const data = readAudio(audio);
  const put = await fetch(uploadURL, {
    method: "PUT",
    body: data,
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "audio/wav" },
  });
  if (!put.ok) {
    const errText = await put.text();
    throw new VocametrixServerError(`Azure upload failed: ${String(put.status)} ${errText}`);
  }
  return blobURL;
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
}
