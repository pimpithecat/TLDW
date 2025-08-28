"use client";

import { ChatMessage, Citation } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Bot } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatMessageProps {
  message: ChatMessage;
  onTimestampClick: (seconds: number) => void;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function ChatMessageComponent({ message, onTimestampClick }: ChatMessageProps) {
  const isUser = message.role === 'user';

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

  // Citation component with tooltip
  const CitationComponent = ({ citationNumber }: { citationNumber: number }) => {
    const citation = citationMap.get(citationNumber);
    
    if (!citation) {
      return <span>[{citationNumber}]</span>;
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <sup className="inline-block ml-0.5">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[10px] text-primary hover:text-primary/80 font-bold no-underline hover:underline"
              onClick={(e) => {
                e.preventDefault();
                onTimestampClick(citation.timestamp);
              }}
            >
              [{citationNumber}]
            </Button>
          </sup>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs p-2">
          <div className="space-y-1">
            <div className="font-semibold text-xs">
              {formatTimestamp(citation.timestamp)}
              {citation.endTime && ` - ${formatTimestamp(citation.endTime)}`}
            </div>
            <div className="text-xs text-muted-foreground line-clamp-3">
              "{citation.text}"
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  // Process text to replace citation patterns with components
  const processTextWithCitations = (text: string): ReactNode[] => {
    const citationPattern = /\[(\d+)\]/g;
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = citationPattern.exec(text)) !== null) {
      // Add text before citation
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      // Add citation component
      const citationNumber = parseInt(match[1], 10);
      parts.push(<CitationComponent key={`citation-${match.index}`} citationNumber={citationNumber} />);

      lastIndex = match.index + match[0].length;
    }

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
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-primary/10' : 'bg-muted'
      }`}>
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      
      <div className={`flex-1 max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <Card className={`p-4 ${isUser ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'}`}>
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2">{renderTextWithCitations(children)}</p>,
                  ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                  li: ({ children }) => <li className="mb-1">{renderTextWithCitations(children)}</li>,
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
          )}
        </Card>
      </div>
    </div>
  );
}