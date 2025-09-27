import { z } from 'zod';

export const topicQuoteSchema = z.object({
  timestamp: z.string(),
  text: z.string()
});

export const topicGenerationSchema = z.array(
  z.object({
    title: z.string(),
    quote: topicQuoteSchema.optional()
  })
);

export const suggestedQuestionsSchema = z.array(z.string());

export const chatQuoteSchema = z.object({
  text: z.string()
});

export const chatResponseSchema = z.object({
  answer: z.string(),
  quotes: z.array(chatQuoteSchema)
});