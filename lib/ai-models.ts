export const DEFAULT_TOPIC_MODEL = 'gemini-2.5-pro-latest' as const;

export const GEMINI_MODEL_CASCADE = [
  'gemini-2.5-pro-latest',
  'gemini-2.5-flash-latest',
  'gemini-2.5-flash-lite-latest'
] as const;

export const DEFAULT_FAST_MODEL = 'gemini-2.5-flash-lite-latest' as const;

export const GEMINI_VALID_MODELS = [
  ...GEMINI_MODEL_CASCADE
] as const;

export type GeminiModel = typeof GEMINI_VALID_MODELS[number];

const LEGACY_MODEL_ALIASES: Record<string, GeminiModel> = {
  'gemini-2.5-pro': 'gemini-2.5-pro-latest',
  'gemini-2.5-flash': 'gemini-2.5-flash-latest',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite-latest',
  'gemini-2.0-flash-thinking': DEFAULT_TOPIC_MODEL,
  'gemini-2.0-flash-thinking-latest': DEFAULT_TOPIC_MODEL
};

const CANONICAL_MODELS = new Map<string, GeminiModel>(
  GEMINI_VALID_MODELS.map((model) => [model, model])
);

const MODEL_ALIAS_ENTRIES = Array.from(
  CANONICAL_MODELS.entries()
) as Array<[string, GeminiModel]>;

for (const [alias, target] of Object.entries(LEGACY_MODEL_ALIASES)) {
  MODEL_ALIAS_ENTRIES.push([alias, target as GeminiModel]);
}

const MODEL_ALIAS_MAP = new Map<string, GeminiModel>(MODEL_ALIAS_ENTRIES);

export function normalizeGeminiModel(input?: string | null): GeminiModel {
  if (!input || typeof input !== 'string') {
    return DEFAULT_TOPIC_MODEL;
  }

  const key = input.trim().toLowerCase();
  return MODEL_ALIAS_MAP.get(key) ?? DEFAULT_TOPIC_MODEL;
}

export function isValidGeminiModel(input: string): input is GeminiModel {
  return MODEL_ALIAS_MAP.has(input.trim().toLowerCase());
}

export const TOPIC_MODEL_OPTIONS = [
  {
    value: 'gemini-2.5-pro-latest',
    label: 'Gemini 2.5 Pro',
    description: 'Best quality for highlight reels'
  },
  {
    value: 'gemini-2.5-flash-latest',
    label: 'Gemini 2.5 Flash',
    description: 'Balanced speed and quality'
  },
  {
    value: 'gemini-2.5-flash-lite-latest',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Fastest option for quick previews'
  }
] as const;

export type TopicModelOption = typeof TOPIC_MODEL_OPTIONS[number];
