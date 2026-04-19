// Env bindings exposed to every Worker handler.
// Matches wrangler.toml bindings + secrets.
export interface Env {
  // KV namespace — single bucket; keys are prefixed by store name
  // (e.g. "memory:all", "history:conversation", "wiki:index").
  KV: KVNamespace;

  // Secrets (wrangler secret put <NAME>)
  OLLAMA_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  TAVILY_API_KEY?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  CESIUM_ION_TOKEN?: string;

  // vars
  DARVIS_MODEL?: string;
  DARVIS_VOICE_ID?: string;
  DEFAULT_TZ?: string;
}
