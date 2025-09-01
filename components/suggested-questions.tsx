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
    <div className="space-y-2">
      {questions.map((question, idx) => {
        const isAsked = askedQuestions.has(question);
        return (
          <Button
            key={idx}
            variant="outline"
            size="sm"
            className={cn(
              "w-full justify-start text-left h-auto py-2 px-3 whitespace-normal transition-all",
              "hover:bg-accent hover:text-accent-foreground",
              isAsked && "opacity-60 border-muted-foreground/30"
            )}
            onClick={() => onQuestionClick(question)}
          >
            <span className="flex items-start gap-2 w-full">
              {isAsked && (
                <Check className="w-3 h-3 mt-0.5 text-green-600 dark:text-green-400 flex-shrink-0" />
              )}
              <span className={cn("text-xs", isAsked && "line-through opacity-80")}>
                {question}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}