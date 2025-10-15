"use client";

import React, { useMemo, ReactNode, useState } from "react";
import { ChatMessage, Citation } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TimestampButton } from "./timestamp-button";
import { Copy, RefreshCw, Check } from "lucide-react";

interface ChatMessageProps {
  message: ChatMessage;
  onCitationClick: (citation: Citation) => void;
  onTimestampClick: (seconds: number, endSeconds?: number, isCitation?: boolean, citationText?: string) => void;
  onRetry?: (messageId: string) => void;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function ChatMessageComponent({ message, onCitationClick, onTimestampClick, onRetry }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  // Handle copy to clipboard
  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [message.content]);

  // Handle retry
  const handleRetry = React.useCallback(() => {
    if (onRetry) {
      onRetry(message.id);
    }
  }, [onRetry, message.id]);

  // Create citation map for quick lookup
  const citationMap = useMemo(() => {
    const map = new Map<number, Citation>();
    if (message.citations) {
      message.citations.forEach(citation => {
        if (citation.number) {
          map.set(citation.number, citation);
        }
      });
    }
    return map;
  }, [message.citations]);

  // Memoized citation component using TimestampButton
  const CitationComponent = React.memo(({ citationNumber }: { citationNumber: number }) => {
    const citation = citationMap.get(citationNumber);
    
    if (!citation) {
      return <span className="text-xs text-muted-foreground">[{citationNumber}]</span>;
    }

    const handleClick = React.useCallback(() => {
      onCitationClick(citation);
    }, [citation, onCitationClick]);

    const timestampText = formatTimestamp(citation.start);

    return (
      <Tooltip delayDuration={0} disableHoverableContent={true}>
        <TooltipTrigger asChild>
          <span className="inline-block ml-1 align-baseline">
            <TimestampButton
              timestamp={timestampText}
              seconds={citation.start}
              onClick={handleClick}
              className="text-[11px]"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent className="p-2 z-[100] pointer-events-none" sideOffset={5}>
          <div className="font-semibold text-xs whitespace-nowrap">
            {formatTimestamp(citation.start)}
            {` - ${formatTimestamp(citation.end)}`}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }, (prevProps, nextProps) => prevProps.citationNumber === nextProps.citationNumber);

  // Process text to replace citation patterns with components
  const processTextWithCitations = (text: string): ReactNode[] => {
    // Pattern for numbered citations, allowing for comma-separated lists
    const citationPattern = /\[([\d,\s]+)\]/g;
    // Pattern for raw timestamps [MM:SS] or [MM:SS-MM:SS]
    const rawTimestampPattern = /\[(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\]/g;
    
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    
    // First, find all patterns and their positions
    const allMatches: Array<{index: number, length: number, element: ReactNode}> = [];
    
    // Find numbered citations (handles both single and grouped)
    let match: RegExpExecArray | null;
    citationPattern.lastIndex = 0;
    while ((match = citationPattern.exec(text)) !== null) {
      const numbersStr = match[1]; // e.g., "1, 2" or "3"
      const citationNumbers = numbersStr.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));

      // Create a component for each number in the matched group
      const citationElements = citationNumbers.map((num, i) => (
        <React.Fragment key={`citation-${match!.index}-${i}`}>
          {i > 0 && <span className="text-xs"> </span>}
          <CitationComponent citationNumber={num} />
        </React.Fragment>
      ));

      if (citationElements.length > 0) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
          element: <span key={`citations-${match!.index}`} className="inline-block">{citationElements}</span>
        });
      }
    }
    
    // Find raw timestamps (as fallback for unprocessed timestamps)
    rawTimestampPattern.lastIndex = 0;
    while ((match = rawTimestampPattern.exec(text)) !== null) {
      // Check if this position already has a numbered citation
      const hasNumberedCitation = allMatches.some(m => 
        m.index === match!.index && m.length === match![0].length
      );
      
      if (!hasNumberedCitation) {
        const [fullMatch, startTime, endTime] = match;
        const [startMin, startSec] = startTime.split(':').map(Number);
        const startSeconds = startMin * 60 + startSec;
        
        // Create a clickable timestamp without citation data
        allMatches.push({
          index: match.index,
          length: match[0].length,
          element: (
            <span key={`raw-timestamp-${match!.index}`} className="inline-block ml-1 align-baseline">
              <TimestampButton
                timestamp={startTime}
                seconds={startSeconds}
                onClick={() => onTimestampClick(startSeconds, undefined, true)}
                className="text-[11px]"
              />
            </span>
          )
        });
      }
    }
    
    // Sort matches by index
    allMatches.sort((a, b) => a.index - b.index);
    
    // Build the parts array
    allMatches.forEach(matchInfo => {
      // Add text before this match
      if (matchInfo.index > lastIndex) {
        parts.push(text.slice(lastIndex, matchInfo.index));
      }
      
      // Add the citation/timestamp element
      parts.push(matchInfo.element);
      
      lastIndex = matchInfo.index + matchInfo.length;
    });
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };

  // Custom renderer for text nodes that processes citations
  const renderTextWithCitations = (children: ReactNode): ReactNode => {
    if (typeof children === 'string') {
      return processTextWithCitations(children);
    }
    
    if (Array.isArray(children)) {
      return children.map((child, index) => {
        if (typeof child === 'string') {
          return <span key={index}>{processTextWithCitations(child)}</span>;
        }
        return child;
      });
    }
    
    return children;
  };

  return (
    <div className="w-full py-2">
      {isUser ? (
        <Card className="p-5 rounded-2xl bg-primary/5 border-0 shadow-none">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </Card>
      ) : (
        <div className="w-full py-1">
          <div className="prose dark:prose-invert max-w-none text-sm [&>*:last-child]:mb-0">
            <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{renderTextWithCitations(children)}</p>,
              ul: ({ children }) => <ul className="list-disc list-inside mb-2 last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside mb-2 last:mb-0">{children}</ol>,
              li: ({ children }) => <li className="mb-1 last:mb-0">{renderTextWithCitations(children)}</li>,
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || '');
                return match ? (
                  <pre className="bg-background/50 p-2 rounded overflow-x-auto mb-2">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                ) : (
                  <code className="bg-background/50 px-1 py-0.5 rounded text-xs" {...props}>
                    {children}
                  </code>
                );
              },
              strong: ({ children }) => <strong className="font-semibold">{renderTextWithCitations(children)}</strong>,
              em: ({ children }) => <em className="italic">{renderTextWithCitations(children)}</em>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic mb-2">
                  {renderTextWithCitations(children)}
                </blockquote>
              ),
              h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{renderTextWithCitations(children)}</h1>,
              h2: ({ children }) => <h2 className="text-base font-semibold mb-2">{renderTextWithCitations(children)}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mb-2">{renderTextWithCitations(children)}</h3>,
              text: ({ children }) => renderTextWithCitations(children) as any,
            }}
          >
            {message.content}
          </ReactMarkdown>
          </div>
          
          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2 mb-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{copied ? 'Copied!' : 'Copy'}</p>
              </TooltipContent>
            </Tooltip>
            
            {onRetry && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRetry}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Retry</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </div>
  );
}