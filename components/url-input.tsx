"use client";

import { useState } from "react";
import { Loader2, ArrowUp, Link } from "lucide-react";
import { extractVideoId } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
}

export function UrlInput({ onSubmit, isLoading = false }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [isFocused, setIsFocused] = useState(false);

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
            "relative flex flex-col items-start gap-[9px] self-stretch rounded-[22px] border border-[#f0f1f1] bg-white p-5 shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)] transition-shadow",
            isFocused && "shadow-[2px_11px_40.4px_rgba(0,0,0,0.1)]",
            error && "ring-2 ring-destructive"
          )}
        >
          <div className="flex w-full items-center justify-between gap-3.5">
            <div className="flex flex-1 items-center gap-2.5">
              <Link className="h-5 w-5 text-[#989999]" strokeWidth={1.8} />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Paste Youtube URL link here..."
                className="flex-1 border-0 bg-transparent text-[14px] text-[#989999] placeholder:text-[#989999] focus:outline-none"
                disabled={isLoading}
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full bg-[#B3B4B4] text-white hover:bg-[#9d9e9e] disabled:bg-[#B3B4B4] disabled:text-white disabled:opacity-100"
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
          <p className="text-xs text-destructive ml-1">{error}</p>
        )}
      </div>
    </form>
  );
}