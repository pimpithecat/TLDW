import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TranscriptSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  duration: z.number(),
});

const RequestSchema = z.object({
  segments: z.array(TranscriptSegmentSchema),
  targetLanguage: z.enum(["id", "en"]),
});

const BATCH_SIZE = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { segments, targetLanguage } = RequestSchema.parse(body);

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const batches: typeof segments[] = [];
    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      batches.push(segments.slice(i, i + BATCH_SIZE));
    }

    const translatedBatches = await Promise.all(
      batches.map(async (batch, batchIndex) => {
        const textsToTranslate = batch.map((seg, idx) => `[${idx}] ${seg.text}`).join("\n");
        
        const systemPrompt = targetLanguage === "id" 
          ? "You are a professional translator. Translate the following English transcript segments to Indonesian. Maintain the natural flow and context. Keep the numbering format [0], [1], etc. Each line is one segment."
          : "You are a professional translator. Translate the following Indonesian transcript segments to English. Maintain the natural flow and context. Keep the numbering format [0], [1], etc. Each line is one segment.";

        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: textsToTranslate }
            ],
            temperature: 0.3,
            max_tokens: 4000,
          });

          const translatedText = completion.choices[0]?.message?.content || "";
          const translatedLines = translatedText.split("\n").filter(line => line.trim());
          
          return batch.map((seg, idx) => {
            const translatedLine = translatedLines.find(line => line.startsWith(`[${idx}]`));
            const translatedContent = translatedLine 
              ? translatedLine.replace(/^\[\d+\]\s*/, "").trim()
              : seg.text;

            return {
              ...seg,
              text: translatedContent,
            };
          });
        } catch (error) {
          console.error(`Error translating batch ${batchIndex}:`, error);
          return batch;
        }
      })
    );

    const translatedSegments = translatedBatches.flat();

    return NextResponse.json({ 
      segments: translatedSegments,
      language: targetLanguage 
    });

  } catch (error) {
    console.error("Translation error:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to translate transcript" },
      { status: 500 }
    );
  }
}
