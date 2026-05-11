import { jest } from "@jest/globals";

// ── helpers ────────────────────────────────────────────────────────────────

type FakeResponse = { ok: boolean; status?: number; json?: () => unknown; text?: () => string; body?: null; headers?: Record<string, string | null> };

function mockFetch(...responses: FakeResponse[]) {
  let call = 0;
  const impl = jest.fn().mockImplementation(() => {
    const r: FakeResponse = (responses[call] ?? responses[responses.length - 1])!;
    call++;
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      body: r.body ?? null,
      headers: {
        get: (k: string) => (r.headers ?? {})[k] ?? null,
      },
      json: r.json ?? (() => Promise.resolve({})),
      text: r.text ?? (() => Promise.resolve("")),
    });
  });
  (global as Record<string, unknown>)["fetch"] = impl;
  return impl;
}

afterEach(() => {
  delete (global as Record<string, unknown>)["fetch"];
  delete process.env["VOCAMETRIX_API_KEY"];
});

// ── VocametrixClient ───────────────────────────────────────────────────────

describe("VocametrixClient", () => {
  test("throws when no API key provided", async () => {
    const { VocametrixClient } = await import("../src/client.js");
    expect(() => new VocametrixClient()).toThrow("API key required");
  });

  test("reads API key from env var", async () => {
    process.env["VOCAMETRIX_API_KEY"] = "env-key";
    const { VocametrixClient } = await import("../src/client.js");
    expect(() => new VocametrixClient()).not.toThrow();
  });

  test("uses provided apiKey option", async () => {
    const { VocametrixClient } = await import("../src/client.js");
    expect(() => new VocametrixClient({ apiKey: "explicit-key" })).not.toThrow();
  });
});

// ── AVQI upload routing ────────────────────────────────────────────────────

describe("avqi.calculate", () => {
  test("uses assignFileId for sustained vowel", async () => {
    const fetch = mockFetch(
      { ok: true, json: () => Promise.resolve({ fileId: "sv123" }) },   // assignFileId
      { ok: true, json: () => Promise.resolve({ AVQI: 3.2 }) },          // calculate-avqi
    );
    const { VocametrixClient } = await import("../src/client.js");
    const client = new VocametrixClient({ apiKey: "test-key" });
    const result = await client.avqi.calculate(Buffer.from("audio")) as Record<string, unknown>;
    expect(result["AVQI"]).toBe(3.2);
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstUrl = (fetch.mock.calls[0] as [string])[0];
    expect(firstUrl).toContain("/api/assignFileId");
  });

  test("uploads both sv and cs when connectedSpeech provided", async () => {
    const fetch = mockFetch(
      { ok: true, json: () => Promise.resolve({ fileId: "sv1" }) },
      { ok: true, json: () => Promise.resolve({ fileId: "cs1" }) },
      { ok: true, json: () => Promise.resolve({ AVQI: 2.1 }) },
    );
    const { VocametrixClient } = await import("../src/client.js");
    const client = new VocametrixClient({ apiKey: "test-key" });
    const result = await client.avqi.calculate(Buffer.from("sv"), Buffer.from("cs")) as Record<string, unknown>;
    expect(result["AVQI"]).toBe(2.1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

// ── Pronunciation blob-url pattern ────────────────────────────────────────

describe("pronunciation.assess", () => {
  test("uses get-blob-url then PUT then assess", async () => {
    const fetch = mockFetch(
      // get-blob-url
      { ok: true, json: () => Promise.resolve({ uploadURL: "https://azure/put", blobURL: "https://azure/blob" }) },
      // Azure PUT
      { ok: true },
      // pronunciation-assessment
      { ok: true, json: () => Promise.resolve({ score: 85 }) },
    );
    const { VocametrixClient } = await import("../src/client.js");
    const client = new VocametrixClient({ apiKey: "test-key" });
    const result = await client.pronunciation.assess(Buffer.from("audio"), "Hello world") as Record<string, unknown>;
    expect(result["score"]).toBe(85);
    const urls = fetch.mock.calls.map((c) => (c as [string])[0]);
    expect(urls[0]).toContain("/api/get-blob-url");
    expect(urls[1]).toBe("https://azure/put");
    expect(urls[2]).toContain("/api/pronunciation-assessment");
  });
});

// ── startSec=0 fix ────────────────────────────────────────────────────────

describe("soundLevel.measure", () => {
  test("replaces startSec=0 with 0.001 and warns", async () => {
    mockFetch(
      { ok: true, json: () => Promise.resolve({ uploadURL: "https://azure/put", blobURL: "https://azure/blob" }) },
      { ok: true },
      { ok: true, json: () => Promise.resolve({ dBFS: -20 }) },
    );
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { VocametrixClient } = await import("../src/client.js");
    const client = new VocametrixClient({ apiKey: "test-key" });
    await client.soundLevel.measure(Buffer.from("audio"), 0);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("0.001"));
    consoleSpy.mockRestore();
  });
});

// ── Retry logic ───────────────────────────────────────────────────────────

describe("fetchWithRetry", () => {
  test("retries on 429 up to 3 times then throws", async () => {
    const fetchMock = mockFetch(
      { ok: false, status: 429, headers: {}, text: () => "rate limited", json: () => Promise.reject(new Error()) },
      { ok: false, status: 429, headers: {}, text: () => "rate limited", json: () => Promise.reject(new Error()) },
      { ok: false, status: 429, headers: {}, text: () => "rate limited", json: () => Promise.reject(new Error()) },
      { ok: false, status: 429, headers: {}, text: () => "rate limited", json: () => Promise.reject(new Error()) },
    );

    jest.useFakeTimers();
    const { fetchWithRetry } = await import("../src/_http.js");
    const { VocametrixRateLimitError } = await import("../src/exceptions.js");

    let caughtError: unknown;
    const settled = fetchWithRetry("https://example.com/test", {}).catch((e) => { caughtError = e; });
    await jest.runAllTimersAsync();
    await settled;

    expect(caughtError).toBeInstanceOf(VocametrixRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });

  test("does not retry 401", async () => {
    const fetchMock = mockFetch(
      { ok: false, status: 401, text: () => "unauthorized", json: () => Promise.resolve({ error: "unauthorized" }) },
    );
    const { fetchWithRetry } = await import("../src/_http.js");
    const { VocametrixAuthError } = await import("../src/exceptions.js");

    let caughtError: unknown;
    await fetchWithRetry("https://example.com/test", {}).catch((e) => { caughtError = e; });

    expect(caughtError).toBeInstanceOf(VocametrixAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Backoff formula ───────────────────────────────────────────────────────

describe("backoff formula", () => {
  test("sleeps 2000ms, 4000ms, 8000ms on consecutive retries", async () => {
    jest.useFakeTimers();
    const sleepDurations: number[] = [];
    const origSetTimeout = global.setTimeout;
    jest.spyOn(global, "setTimeout").mockImplementation((fn: (_: void) => void, ms?: number) => {
      if (ms !== undefined) sleepDurations.push(ms);
      return origSetTimeout(fn, 0);
    });

    mockFetch(
      { ok: false, status: 503, text: () => "err", json: () => Promise.reject(new Error()) },
      { ok: false, status: 503, text: () => "err", json: () => Promise.reject(new Error()) },
      { ok: false, status: 503, text: () => "err", json: () => Promise.reject(new Error()) },
      { ok: false, status: 503, text: () => "err", json: () => Promise.reject(new Error()) },
    );

    const { fetchWithRetry } = await import("../src/_http.js");
    const settled = fetchWithRetry("https://example.com/", {}).catch(() => {});
    await jest.runAllTimersAsync();
    await settled;
    jest.restoreAllMocks();
    jest.useRealTimers();

    expect(sleepDurations.slice(0, 3)).toEqual([2000, 4000, 8000]);
  });
});

// ── retryAfter forwarded to error ─────────────────────────────────────────

describe("rate limit retryAfter propagation", () => {
  test("VocametrixRateLimitError.retryAfter matches Retry-After header", async () => {
    jest.useFakeTimers();
    mockFetch(
      { ok: false, status: 429, headers: { "Retry-After": "30" }, text: () => "rate limited", json: () => Promise.reject(new Error()) },
      { ok: false, status: 429, headers: { "Retry-After": "30" }, text: () => "rate limited", json: () => Promise.reject(new Error()) },
      { ok: false, status: 429, headers: { "Retry-After": "30" }, text: () => "rate limited", json: () => Promise.reject(new Error()) },
      { ok: false, status: 429, headers: { "Retry-After": "30" }, text: () => "rate limited", json: () => Promise.reject(new Error()) },
    );
    const { fetchWithRetry } = await import("../src/_http.js");
    const { VocametrixRateLimitError } = await import("../src/exceptions.js");

    let caughtError: unknown;
    const settled = fetchWithRetry("https://example.com/", {}).catch((e) => { caughtError = e; });
    await jest.runAllTimersAsync();
    await settled;
    jest.useRealTimers();

    expect(caughtError).toBeInstanceOf(VocametrixRateLimitError);
    expect((caughtError as { retryAfter?: number }).retryAfter).toBe(30);
  });
});
