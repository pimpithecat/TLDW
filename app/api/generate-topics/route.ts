import { NextRequest, NextResponse } from 'next/server';
import { generateTopicsRequestSchema, formatValidationError } from '@/lib/validation';
import { z } from 'zod';
import { withSecurity } from '@/lib/security-middleware';
import { generateTopicsFromTranscript } from '@/lib/ai-processing';
import { DEFAULT_TOPIC_MODEL, normalizeGeminiModel } from '@/lib/ai-models';
import { createClient } from '@/lib/supabase/server';


async function handler(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();

    let validatedData;
    try {
      validatedData = generateTopicsRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: formatValidationError(error)
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const { transcript, model, includeCandidatePool, excludeTopicKeys, videoInfo } = validatedData;

    let resolvedModel = normalizeGeminiModel(model ?? DEFAULT_TOPIC_MODEL);

    if (!model) {
      try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const userPreferredModel = typeof user?.user_metadata?.defaultTopicModel === 'string'
          ? user.user_metadata.defaultTopicModel
          : undefined;
        if (userPreferredModel) {
          resolvedModel = normalizeGeminiModel(userPreferredModel);
        }
      } catch (prefError) {
        console.warn('Unable to load user model preference:', prefError);
      }
    }

    // Use the shared function to generate topics
    const { topics, candidates } = await generateTopicsFromTranscript(transcript, resolvedModel, {
      videoInfo,
      includeCandidatePool,
      excludeTopicKeys: new Set(excludeTopicKeys ?? [])
    });

    return NextResponse.json({
      topics,
      topicCandidates: includeCandidatePool ? candidates ?? [] : undefined
    });
  } catch (error) {
    // Log error details server-side only
    console.error('Error generating topics:', error);

    // Return generic error message to client
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    );
  }
}

// Apply security with generation rate limits (dynamic based on auth)
export const POST = withSecurity(handler, {
  maxBodySize: 10 * 1024 * 1024, // 10MB for large transcripts
  allowedMethods: ['POST']
  // Note: Rate limiting is handled internally by the route for dynamic limits based on auth
});
