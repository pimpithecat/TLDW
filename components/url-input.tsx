"use client";

import { useState } from "react";
import { Loader2, ArrowUp, Link } from "lucide-react";
import { extractVideoId } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ModeSelector } from "@/components/mode-selector";
import type { TopicGenerationMode } from "@/lib/types";

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
  mode?: TopicGenerationMode;
  onModeChange?: (mode: TopicGenerationMode) => void;
}

export function UrlInput({ onSubmit, isLoading = false, mode, onModeChange }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const showModeSelector = typeof onModeChange === "function";
  const modeValue: TopicGenerationMode = mode ?? "smart";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!url.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    onSubmit(url);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[615px]">
      <div className="flex flex-col gap-2">
        <Card
          className={cn(
            "relative flex flex-col items-start gap-6 self-stretch rounded-[22px] border border-[#f0f1f1] bg-white px-6 pt-6 pb-3 shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)] transition-shadow",
            isFocused && "shadow-[2px_11px_40.4px_rgba(0,0,0,0.1)]",
            error && "ring-2 ring-destructive"
          )}
        >
          {/* Top row: Input field only */}
          <div className="flex w-full items-center gap-2.5">
            <div className="w-5 flex items-center justify-end shrink-0">
              <Link className="h-5 w-5 text-[#989999]" strokeWidth={1.8} />
            </div>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Paste Youtube URL link here..."
              className="flex-1 border-0 bg-transparent text-[16px] text-[#989999] placeholder:text-[#989999] focus:outline-none"
              disabled={isLoading}
            />
          </div>

          {/* Bottom row: Mode selector (left) and submit button (right) */}
          <div
            className={cn(
              "flex w-full items-center gap-3",
              showModeSelector ? "justify-between" : "justify-end"
            )}
          >
            {showModeSelector && (
              <ModeSelector value={modeValue} onChange={onModeChange} />
            )}
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full bg-black text-white hover:bg-gray-800 disabled:bg-[#B3B4B4] disabled:text-white disabled:opacity-100"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </Card>
        {error && (
          <p className="text-xs text-destructive px-1">{error}</p>
        )}
      </div>
    </form>
  );
}
