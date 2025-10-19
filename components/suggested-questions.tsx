"use client";

import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface SuggestedQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string) => void;
  isLoading?: boolean;
  isChatLoading?: boolean;
  askedQuestions?: Set<string>;
}

export function SuggestedQuestions({
  questions,
  onQuestionClick,
  isLoading,
  isChatLoading = false,
  askedQuestions = new Set(),
}: SuggestedQuestionsProps) {
  if (isLoading && questions.length === 0) {
    return (
      <div className="flex justify-end w-full">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          <span>Generating questions...</span>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col items-end gap-2">
      {questions.map((question, idx) => {
        const isAsked = askedQuestions.has(question);
        return (
          <Button
            key={`${question}-${idx}`}
            variant="pill"
            size="sm"
            className="self-end w-fit h-auto max-w-full sm:max-w-[80%] justify-start text-left whitespace-normal break-words leading-snug py-2 px-4 transition-colors hover:bg-neutral-100"
            onClick={() => onQuestionClick(question)}
            disabled={isChatLoading || isAsked}
          >
            {question}
          </Button>
        );
      })}
    </div>
  );
}
