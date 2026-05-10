# vocametrix

[![npm version](https://img.shields.io/npm/v/vocametrix)](https://www.npmjs.com/package/vocametrix)
[![CI](https://github.com/pmarmaroli/vocametrix-js/actions/workflows/ci.yml/badge.svg)](https://github.com/pmarmaroli/vocametrix-js/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![API docs](https://img.shields.io/badge/API-docs-blue)](https://www.vocametrix.com/api-docs)

Official JavaScript/TypeScript SDK for the [Vocametrix API](https://www.vocametrix.com/api-docs) — voice analysis, speech therapy, and acoustic measurement for speech-language pathologists, voice researchers, and developers.

## Get an API key

**Vocametrix is a commercial API. You need an account to use this SDK.**

- [Sign up](https://www.vocametrix.com/registration) — create an account and get your API key. New accounts include a **free trial** (5 minutes of analysis or 5 API credits, whichever comes first) so you can run the quickstart below without entering payment details.
- [Pricing](https://www.vocametrix.com/pricing) — see plans and rates once your trial is used up.

Once you have a key, every call is one `VOCAMETRIX_API_KEY` env var away.

## Install

```bash
npm install vocametrix
```

Requires Node.js ≥ 18. Works in ESM and CJS projects.

## 30-second quickstart

```bash
export VOCAMETRIX_API_KEY="your-api-key-here"
```

```ts
import { VocametrixClient } from "vocametrix";

const client = new VocametrixClient(); // reads VOCAMETRIX_API_KEY from environment

// AVQI — clinically validated dysphonia score (Maryn & Weenink 2015)
const result = await client.avqi.calculate("vowel.wav");
console.log(result["AVQI"]);    // e.g. 1.8 → normal (threshold: 2.97)
console.log(result["CPP"], result["HNR25"]);
```

## Authentication

Set the `VOCAMETRIX_API_KEY` environment variable, or pass it explicitly:

```ts
import { VocametrixClient } from "vocametrix";

// From env var (recommended — never hardcode keys)
const client = new VocametrixClient();

// Explicit key (e.g. loaded from a secrets manager)
const client2 = new VocametrixClient({ apiKey: "va_..." });
```

Never hardcode API keys in source code. Use environment variables or a secrets manager.

## What's included

| Namespace | What it does |
|-----------|-------------|
| `client.avqi` | AVQI dysphonia index (Maryn/Barsties) |
| `client.dsi` | Dysphonia Severity Index |
| `client.cpp` | Cepstral Peak Prominence |
| `client.hnr` | Multi-band Harmonics-to-Noise Ratio |
| `client.jitterShimmer` | Jitter & shimmer (Teixeira & Gonçalves 2014) |
| `client.vrp` | Voice Range Profile (ambitus / glissando) |
| `client.pronunciation` | Pronunciation assessment (30+ locales) |
| `client.transcription` | Async speech-to-text with SSE |
| `client.tts` | Text-to-speech with per-character timing |
| `client.phoneme` | Phoneme detection (French, Estonian) |
| `client.stuttering` | Stuttering classification (async polling) |
| `client.prosody` | Prosody similarity (model vs learner) |
| `client.egemaps` | eGeMAPS 88-feature extraction |
| `client.soundLevel` | Sound level measurement (dB SPL) |

## Workflows

### Pronunciation assessment

```ts
const result = await client.pronunciation.assess(
  "recording.wav",
  "Hello, my name is Alex.",
  "en-US",
);
console.log(result["accuracyScore"], result["fluencyScore"]);
for (const word of result["words"] as Array<Record<string, unknown>>) {
  console.log(word["word"], word["accuracyScore"]);
}
```

### Batch AVQI over a folder

```ts
import { readdirSync } from "fs";
import path from "path";

for (const file of readdirSync("./recordings").filter(f => f.endsWith(".wav"))) {
  const result = await client.avqi.calculate(path.join("recordings", file));
  const avqi = result["AVQI"] as number;
  console.log(`${file}: AVQI=${avqi.toFixed(2)} (${avqi < 2.97 ? "Normal" : "Dysphonic"})`);
}
```

### Async transcription with SSE

```ts
for await (const event of client.transcription.stream("recording.wav", "en-US")) {
  console.log(event.status, event.progress);
  if (event.isTerminalSuccess) {
    console.log("Transcript:", event.displayText);
  }
}
```

## Error handling

```ts
import {
  VocametrixAuthError,       // 401 — bad or missing API key
  VocametrixRateLimitError,  // 429 — SDK retries automatically (up to 3×)
  VocametrixValidationError, // 422 — invalid parameter values
  VocametrixServerError,     // 5xx — SDK retries automatically
} from "vocametrix";

try {
  const result = await client.avqi.calculate("vowel.wav");
} catch (err) {
  if (err instanceof VocametrixRateLimitError) {
    console.error(`Rate limited. Retry after ${err.retryAfter}s`);
  } else if (err instanceof VocametrixAuthError) {
    console.error("Check your API key at https://www.vocametrix.com/registration");
  }
}
```

The SDK retries `429`, `500`, `502`, `503`, `504` with exponential backoff (up to 3 retries). Non-retriable errors (`4xx` except `429`) raise immediately.

## Longer examples

See [vocametrix-examples](https://github.com/pmarmaroli/vocametrix-examples) for:
- End-to-end workflow scripts (batch pronunciation, full voice assessment, prosody loops)
- Jupyter notebooks with cohort visualizations

## API reference

- [Interactive docs](https://www.vocametrix.com/api-docs)
- [OpenAPI 3.1 spec](https://www.vocametrix.com/openapi.json) — for typed client generation or Swagger UI

## Related SDKs

- [vocametrix-python](https://github.com/pmarmaroli/vocametrix-python) — Python SDK (`pip install vocametrix`)

## Contributing

```bash
git clone https://github.com/pmarmaroli/vocametrix-js
cd vocametrix-js
npm install

# Regenerate the low-level client from the live OpenAPI spec
npm run regenerate

# Type check
npm run typecheck

# Lint
npm run lint

# Build (ESM + CJS + types)
npm run build

# Run unit tests (no API key needed — all mocked)
npm test
```

The `src/_generated/` directory is auto-generated. Do not edit it manually. All hand-written logic lives in `src/client.ts`, `src/namespaces.ts`, `src/_http.ts`, and `src/exceptions.ts`.

## License

The `vocametrix` SDK is released under the [MIT License](LICENSE). You're free to use, modify, and redistribute the SDK source code.

**Calling the Vocametrix API with this SDK requires an API key, which is issued with a paid Vocametrix account.** The SDK code is free; the service is not. See [pricing](https://www.vocametrix.com/pricing).
