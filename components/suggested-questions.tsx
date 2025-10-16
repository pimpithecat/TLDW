"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestedQuestionsProps {
  questions: string[];
  onQuestionClick: (question: string) => void;
  isLoading?: boolean;
  askedQuestions?: Set<string>;
}

export function SuggestedQuestions({ questions, onQuestionClick, isLoading, askedQuestions = new Set() }: SuggestedQuestionsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftGradient, setShowLeftGradient] = useState(false);
  const [showRightGradient, setShowRightGradient] = useState(false);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeftGradient(scrollLeft > 5);
      setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    // Check scroll on mount and when questions change
    checkScroll();

    // Add scroll listener
    scrollElement.addEventListener('scroll', checkScroll);
    
    // Add resize listener to handle window resizing
    window.addEventListener('resize', checkScroll);

    return () => {
      scrollElement.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [questions, askedQuestions]);

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
    <div className="relative -mx-6 px-6 overflow-hidden">
      {/* Left gradient indicator */}
      <div 
        className={cn(
          "absolute left-6 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent pointer-events-none z-10 transition-opacity duration-300",
          showLeftGradient ? "opacity-100" : "opacity-0"
        )}
      />
      
      {/* Right gradient indicator */}
      <div 
        className={cn(
          "absolute right-6 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none z-10 transition-opacity duration-300",
          showRightGradient ? "opacity-100" : "opacity-0"
        )}
      />

      <div 
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide pb-2"
      >
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
    </div>
  );
}