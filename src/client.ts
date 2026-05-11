import {
  AvqiNamespace,
  CppNamespace,
  DsiNamespace,
  EgemapsNamespace,
  HnrNamespace,
  JitterShimmerNamespace,
  PhonemeNamespace,
  PronunciationNamespace,
  ProsodyNamespace,
  SoundLevelNamespace,
  StutteringNamespace,
  TranscriptionNamespace,
  TtsNamespace,
  VrpNamespace,
} from "./namespaces.js";

const DEFAULT_BASE_URL = "https://platform.vocametrix.com";

export interface VocametrixClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Default SDK email used in upload requests */
  email?: string;
}

export class VocametrixClient {
  readonly avqi: AvqiNamespace;
  readonly dsi: DsiNamespace;
  readonly cpp: CppNamespace;
  readonly hnr: HnrNamespace;
  readonly jitterShimmer: JitterShimmerNamespace;
  readonly vrp: VrpNamespace;
  readonly pronunciation: PronunciationNamespace;
  readonly transcription: TranscriptionNamespace;
  readonly tts: TtsNamespace;
  readonly phoneme: PhonemeNamespace;
  readonly stuttering: StutteringNamespace;
  readonly prosody: ProsodyNamespace;
  readonly egemaps: EgemapsNamespace;
  readonly soundLevel: SoundLevelNamespace;

  private readonly _apiKey: string;
  private readonly _baseUrl: string;
  private readonly _authHeaders: Record<string, string>;

  constructor(options: VocametrixClientOptions = {}) {
    const rawKey = options.apiKey ?? process.env["VOCAMETRIX_API_KEY"];
    const key = rawKey?.trim();
    if (!key) {
      throw new Error(
        "API key required. Pass apiKey: '...' or set VOCAMETRIX_API_KEY env var.",
      );
    }
    this._apiKey = key;
    this._baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this._authHeaders = { "X-API-Key": this._apiKey };
    // Matches the Python SDK default. The backend currently only accepts a
    // small allow-list of SDK emails; do not change without backend support.
    const email = options.email ?? "info@vocametrix.com";

    const b = this._baseUrl;
    const h = this._authHeaders;
    this.avqi = new AvqiNamespace(b, h, email);
    this.dsi = new DsiNamespace(b, h, email);
    this.cpp = new CppNamespace(b, h, email);
    this.hnr = new HnrNamespace(b, h, email);
    this.jitterShimmer = new JitterShimmerNamespace(b, h, email);
    this.vrp = new VrpNamespace(b, h, email);
    this.pronunciation = new PronunciationNamespace(b, h);
    this.transcription = new TranscriptionNamespace(b, h, this._apiKey);
    this.tts = new TtsNamespace(b, h);
    this.phoneme = new PhonemeNamespace(b, h, email);
    this.stuttering = new StutteringNamespace(b, h, email);
    this.prosody = new ProsodyNamespace(b, h, email);
    this.egemaps = new EgemapsNamespace(b, h, email);
    this.soundLevel = new SoundLevelNamespace(b, h);
  }
}
