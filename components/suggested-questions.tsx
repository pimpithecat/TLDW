"use client";

import { Button } from "@/components/ui/button";
interface SuggestedQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string, index: number) => void;
  isLoading?: boolean;
  isChatLoading?: boolean;
}

export function SuggestedQuestions({
  questions,
  onQuestionClick,
  isLoading,
  isChatLoading = false,
}: SuggestedQuestionsProps) {
  if (questions.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col items-end gap-2">
      {questions.map((question, idx) => {
        return (
          <Button
            key={`${question}-${idx}`}
            variant="pill"
            size="sm"
            className="self-end w-fit h-auto max-w-full sm:max-w-[80%] justify-start text-left whitespace-normal break-words leading-snug py-2 px-4 transition-colors hover:bg-neutral-100"
            onClick={() => onQuestionClick(question, idx)}
            disabled={isChatLoading}
          >
            {question}
          </Button>
        );
      })}
    </div>
  );
}
