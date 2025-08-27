"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { extractVideoId } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
}

export function UrlInput({ onSubmit, isLoading = false }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

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
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube URL here..."
            className={cn(
              "flex-1 px-4 py-3 rounded-lg border bg-background",
              "focus:outline-none focus:ring-2 focus:ring-blue-500",
              error && "border-red-500"
            )}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className={cn(
              "px-6 py-3 rounded-lg font-medium transition-all",
              "bg-blue-600 text-white hover:bg-blue-700",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "flex items-center gap-2"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Analyze
              </>
            )}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    </form>
  );
}