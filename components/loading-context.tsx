"use client";

import { VideoInfo } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, User, FileText } from "lucide-react";

interface LoadingContextProps {
  videoInfo?: VideoInfo | null;
  preview?: string;
  stage: 'fetching' | 'understanding' | 'generating';
  elapsedTime?: number;
}

export function LoadingContext({ videoInfo, preview, stage, elapsedTime }: LoadingContextProps) {
  const stageMessages = {
    fetching: 'Fetching transcript...',
    understanding: 'Understanding content...',
    generating: 'Creating highlight reels...'
  };

  const stageProgress = {
    fetching: 33,
    understanding: 66,
    generating: 90
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Video Info Card */}
      {videoInfo ? (
        <Card className="p-6">
          <div className="flex gap-6">
            {/* Thumbnail */}
            <div className="flex-shrink-0">
              <img 
                src={videoInfo.thumbnail} 
                alt={videoInfo.title}
                className="w-48 h-27 object-cover rounded-md"
              />
            </div>
            
            {/* Video Details */}
            <div className="flex-1 space-y-3">
              <h3 className="text-lg font-semibold line-clamp-2">
                {videoInfo.title}
              </h3>
              
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <User className="w-4 h-4" />
                  <span>{videoInfo.author}</span>
                </div>
                {videoInfo.duration && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>{Math.floor(videoInfo.duration / 60)} min</span>
                  </div>
                )}
              </div>

              {/* Preview text */}
              {preview && (
                <div className="pt-2">
                  <div className="flex items-start gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {preview}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="flex gap-6">
            <Skeleton className="w-48 h-27 rounded-md" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </Card>
      )}

      {/* Progress Indicator */}
      <Card className="p-4">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">
              {stageMessages[stage]}
              {elapsedTime !== undefined && ` (${elapsedTime} seconds)`}
            </span>
            <span className="text-sm text-muted-foreground">{stageProgress[stage]}%</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div 
              className="bg-primary h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${stageProgress[stage]}%` }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}