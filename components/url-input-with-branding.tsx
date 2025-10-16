"use client";

import { useState } from "react";
import { Loader2, ArrowUp, Link as LinkIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { extractVideoId } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface UrlInputWithBrandingProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
}

export function UrlInputWithBranding({ onSubmit, isLoading = false }: UrlInputWithBrandingProps) {
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
            "relative flex flex-col items-start gap-[9px] self-stretch rounded-[22px] border border-[#f0f1f1] bg-white p-6 shadow-[2px_11px_40.4px_rgba(0,0,0,0.06)] transition-shadow",
            isFocused && "shadow-[2px_11px_40.4px_rgba(0,0,0,0.1)]",
            error && "ring-2 ring-destructive"
          )}
        >
          <div className="flex w-full items-center justify-between gap-3.5">
            {/* Left: TLDW Logo and Text */}
            <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Go to TLDW home">
              <Image
                src="/Video_Play.svg"
                alt="TLDW logo"
                width={29}
                height={29}
                className="h-7 w-7"
                priority
              />
              <p className="text-sm font-semibold text-slate-800">TLDW</p>
            </Link>

            {/* Vertical Separator */}
            <div className="h-6 w-px bg-[#e5e7eb] shrink-0" />

            {/* Middle: Input Field */}
            <div className="flex flex-1 items-center gap-2.5 min-w-0">
              <LinkIcon className="h-5 w-5 text-[#989999] shrink-0" strokeWidth={1.8} />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Paste Youtube URL link here..."
                className="flex-1 border-0 bg-transparent text-[14px] text-[#989999] placeholder:text-[#989999] focus:outline-none min-w-0"
                disabled={isLoading}
              />
            </div>

            {/* Right: Submit Button */}
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

