"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, Check } from "lucide-react";
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

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-6 px-6">
      {questions.map((question, idx) => {
        const isAsked = askedQuestions.has(question);
        return (
          <Button
            key={idx}
            variant="pill"
            size="sm"
            className={cn(
              "h-auto py-2 px-4 whitespace-nowrap transition-all text-sm flex-shrink-0",
              "hover:bg-neutral-100",
              isAsked && "opacity-60 border-muted-foreground/30"
            )}
            onClick={() => onQuestionClick(question)}
          >
            <span className="flex items-center gap-2">
              {isAsked && (
                <Check className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" />
              )}
              <span className={cn(isAsked && "line-through opacity-80")}>
                {question}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}