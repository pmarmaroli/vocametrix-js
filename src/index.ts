export { VocametrixClient } from "./client.js";
export type { VocametrixClientOptions } from "./client.js";

export {
  VocametrixError,
  VocametrixAuthError,
  VocametrixForbiddenError,
  VocametrixNotFoundError,
  VocametrixValidationError,
  VocametrixRateLimitError,
  VocametrixServerError,
} from "./exceptions.js";

export type { AudioInput, SseEvent } from "./_http.js";
export type { TranscriptionEvent } from "./namespaces.js";
