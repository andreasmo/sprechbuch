export {
  costOf, extractJson, LlmClient, LlmError,
  type CompletionRequest, type CompletionResult, type HttpRequest, type HttpResponse, type JsonSchema, type LlmErrorKind,
  type Transport, type Usage,
} from "./client.js";
export {
  authStyle, configFromPreset, hostOf, isLocalUrl, normalizeBaseUrl, presetById, PRESETS,
  type AuthStyle, type ModelPreset, type ProviderConfig, type ProviderKind, type ProviderPreset, type StructuredMode,
} from "./providers.js";
export { estimateJobs, estimateTokens, type LlmJob } from "./jobs.js";
export { castListText, countAsked, speakerJobs, SURE_CONFIDENCE, type SpeakerJobOptions, type SpeakerJobResult } from "./speakers.js";
export { castMergeJob, type MergeSuggestion } from "./cast.js";
export { openPronunciations, pronunciationJob } from "./pronunciation.js";
export { runJobs, type RunOptions, type RunSummary } from "./run.js";
export { alignBlocks, compareSpeakers, type SpeakerAccuracy } from "./evaluate.js";
