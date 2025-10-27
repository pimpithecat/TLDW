"use client";

import { VideoInfo } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, User } from "lucide-react";

interface LoadingContextProps {
  videoInfo?: VideoInfo | null;
  preview?: string;
}

export function LoadingContext({ videoInfo, preview }: LoadingContextProps) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Video Info Card */}
      {videoInfo ? (
        <Card className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
            {/* Thumbnail */}
            <div className="flex-shrink-0 w-full md:w-48">
              <img
                src={videoInfo.thumbnail}
                alt={videoInfo.title}
                className="w-full md:w-48 h-auto md:h-27 object-cover rounded-md"
              />
            </div>

            {/* Video Details */}
            <div className="flex-1 space-y-3">
              <h3 className="text-base md:text-lg font-semibold line-clamp-2">
                {videoInfo.title}
              </h3>

              <div className="flex flex-wrap items-center gap-3 md:gap-4 text-xs md:text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="line-clamp-1">{videoInfo.author}</span>
                </div>
                {videoInfo.duration && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span>{Math.floor(videoInfo.duration / 60)} min</span>
                  </div>
                )}
              </div>

              {/* Quick Preview */}
              {preview && preview !== 'Processing video content...' && (
                <div className="pt-2">
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    {preview}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
            <Skeleton className="w-full md:w-48 h-40 md:h-27 rounded-md" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 md:h-6 w-full md:w-3/4" />
              <Skeleton className="h-4 w-2/3 md:w-1/2" />
              {/* Show preview even without video info */}
              {preview && preview !== 'Processing video content...' ? (
                <div className="pt-2">
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    {preview}
                  </p>
                </div>
              ) : (
                <Skeleton className="h-16 w-full" />
              )}
            </div>
          </div>
        </Card>
      )}

    </div>
  );
}