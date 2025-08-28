"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface SuggestedQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string) => void;
  isLoading?: boolean;
}

export function SuggestedQuestions({ questions, onQuestionClick, isLoading }: SuggestedQuestionsProps) {
  if (isLoading) {
    return (
      <Card className="p-4 bg-muted/30">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" />
          <p className="text-sm font-medium text-muted-foreground">Generating suggested questions...</p>
        </div>
      </Card>
    );
  }

  if (!questions || questions.length === 0) {
    return null;
  }

  return (
    <Card className="p-4 bg-muted/30">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Suggested questions</p>
      </div>
      <div className="space-y-2">
        {questions.map((question, idx) => (
          <Button
            key={idx}
            variant="outline"
            size="sm"
            className="w-full justify-start text-left h-auto py-2 px-3 whitespace-normal"
            onClick={() => onQuestionClick(question)}
          >
            {question}
          </Button>
        ))}
      </div>
    </Card>
  );
}