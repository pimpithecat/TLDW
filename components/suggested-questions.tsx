"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestedQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string) => void;
  isLoading?: boolean;
  askedQuestions?: Set<string>;
}

export function SuggestedQuestions({ questions, onQuestionClick, isLoading, askedQuestions = new Set() }: SuggestedQuestionsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Sparkles className="w-4 h-4 text-primary animate-pulse" />
        <p className="text-xs text-muted-foreground">Generating questions...</p>
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return null;
  }

  // Filter out questions that have already been asked
  const unaskedQuestions = questions.filter(question => !askedQuestions.has(question));

  // Don't render if all questions have been asked
  if (unaskedQuestions.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-6 px-6">
      {unaskedQuestions.map((question, idx) => (
        <Button
          key={idx}
          variant="pill"
          size="sm"
          className="h-auto py-2 px-4 whitespace-nowrap transition-all text-sm flex-shrink-0 hover:bg-neutral-100"
          onClick={() => onQuestionClick(question)}
        >
          {question}
        </Button>
      ))}
    </div>
  );
}