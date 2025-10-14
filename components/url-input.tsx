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
    <form onSubmit={handleSubmit} className="w-full max-w-[683px]">
      <div className="flex flex-col gap-2">
        <Card
          className={cn(
            "relative rounded-[24px] border border-[#f0f1f1] bg-white px-6 py-5 shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)] transition-shadow",
            isFocused && "shadow-[2px_11px_40.4px_rgba(0,0,0,0.1)]",
            error && "ring-2 ring-destructive"
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-1 items-center gap-3">
              <Link className="h-6 w-6 text-[#989999]" strokeWidth={1.8} />
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
            <Button
              type="submit"
              disabled={isLoading || !url.trim()}
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full bg-black text-white hover:bg-black/90"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </Card>
        {error && (
          <p className="text-sm text-destructive ml-1">{error}</p>
        )}
      </div>
    </form>
  );
}