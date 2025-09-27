import { GoogleGenerativeAI, GenerationConfig } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const MODEL_CASCADE = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
] as const;

type ValidModel = typeof MODEL_CASCADE[number];

interface GeminiModelConfig {
  generationConfig?: GenerationConfig;
  preferredModel?: string;
  timeoutMs?: number;
}

function isValidModel(model: string): model is ValidModel {
  return MODEL_CASCADE.includes(model as ValidModel);
}

function isRetryableError(error: any): boolean {
  return error?.status === 503 ||
         error?.status === 429 ||
         error?.message?.includes('503') ||
         error?.message?.includes('429') ||
         error?.message?.includes('overload') ||
         error?.message?.includes('rate limit');
}

function getErrorType(error: any): string {
  if (error?.status === 503 || error?.message?.includes('503') || error?.message?.includes('overload')) {
    return 'overloaded';
  }
  if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('rate limit')) {
    return 'rate limited';
  }
  if (error?.status === 401 || error?.message?.includes('401') || error?.message?.includes('unauthorized')) {
    return 'authentication failed';
  }
  if (error?.status === 400 || error?.message?.includes('400')) {
    return 'invalid request';
  }
  return 'unknown error';
}

export async function generateWithFallback(
  prompt: string,
  config: GeminiModelConfig = {}
): Promise<string> {
  if (config.preferredModel && !isValidModel(config.preferredModel)) {
    console.warn(`Invalid preferredModel "${config.preferredModel}", using default cascade`);
  }

  const models = config.preferredModel && isValidModel(config.preferredModel)
    ? [config.preferredModel, ...MODEL_CASCADE.filter(m => m !== config.preferredModel)]
    : [...MODEL_CASCADE];

  let lastError: any;
  const attemptedModels: string[] = [];

  for (const modelName of models) {
    attemptedModels.push(modelName);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: config.generationConfig
      });

      const generatePromise = model.generateContent(prompt);

      const result = config.timeoutMs
        ? await Promise.race([
            generatePromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Request timeout')), config.timeoutMs)
            )
          ])
        : await generatePromise;

      const response = (result as any).response.text();

      if (response) {
        console.log(`Content generated using ${modelName}`);
        return response;
      }

      console.warn(`Model ${modelName} returned empty response, trying next...`);
    } catch (error) {
      lastError = error;
      const errorType = getErrorType(error);

      if (!isRetryableError(error)) {
        console.error(`Model ${modelName} failed with non-retryable error (${errorType}):`, error);
        throw new Error(`Gemini API error (${errorType}): ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      console.log(`Model ${modelName} ${errorType}, trying next...`);
    }
  }

  const errorType = getErrorType(lastError);
  throw new Error(
    `All Gemini models failed after trying: ${attemptedModels.join(', ')}. ` +
    `Last error type: ${errorType}. ` +
    `${lastError instanceof Error ? lastError.message : 'Unknown error'}`
  );
}