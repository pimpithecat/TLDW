"use client";

import React from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimestampButtonProps {
  timestamp: string;
  seconds: number;
  onClick: (seconds: number) => void;
  className?: string;
  showIcon?: boolean;
}

export function TimestampButton({ 
  timestamp, 
  seconds, 
  onClick, 
  className,
  showIcon = true 
}: TimestampButtonProps) {
  const handleClick = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(seconds);
  }, [seconds, onClick]);

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
        "bg-gray-500/10 hover:bg-gray-500/20 dark:bg-gray-400/10 dark:hover:bg-gray-400/20",
        "text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300",
        "text-xs font-medium transition-all duration-200",
        "cursor-pointer select-none align-baseline",
        "border border-gray-200/50 dark:border-gray-700/50",
        className
      )}
      style={{ pointerEvents: 'auto', userSelect: 'none' }}
      aria-label={`Jump to ${timestamp}`}
    >
      {showIcon && (
        <Play className="w-3 h-3 fill-current" />
      )}
      <span>{timestamp}</span>
    </button>
  );
}