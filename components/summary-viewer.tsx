"use client";

import React, { ReactNode, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseTimestamp, TIMESTAMP_REGEX } from "@/lib/timestamp-utils";

interface SummaryViewerProps {
  content: string;
  onTimestampClick?: (seconds: number) => void;
}

export function SummaryViewer({ content, onTimestampClick }: SummaryViewerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  
  // Get the actual scroll viewport element
  const getScrollViewport = useCallback(() => {
    if (scrollAreaRef.current) {
      // The viewport is the element with data-slot="scroll-area-viewport"
      return scrollAreaRef.current.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    }
    return null;
  }, []);
  
  // Save scroll position before any interaction
  const saveScrollPosition = useCallback(() => {
    const viewport = getScrollViewport();
    if (viewport) {
      scrollPositionRef.current = viewport.scrollTop;
    }
  }, [getScrollViewport]);
  
  // Restore scroll position if needed
  const restoreScrollPosition = useCallback(() => {
    const viewport = getScrollViewport();
    if (viewport) {
      viewport.scrollTop = scrollPositionRef.current;
    }
  }, [getScrollViewport]);
  
  // Handle timestamp click with scroll preservation
  const handleTimestampClick = useCallback((seconds: number) => {
    saveScrollPosition();
    if (onTimestampClick) {
      onTimestampClick(seconds);
      // Use requestAnimationFrame to ensure DOM has updated before restoring
      requestAnimationFrame(() => {
        restoreScrollPosition();
      });
    }
  }, [onTimestampClick, saveScrollPosition, restoreScrollPosition]);
  // Process text to make timestamps clickable
  const processTextWithTimestamps = (text: string | ReactNode): ReactNode => {
    if (!onTimestampClick || typeof text !== 'string') return text;
    
    // Use improved regex to avoid false matches with version numbers, ratios, etc.
    const timestampRegex = new RegExp(TIMESTAMP_REGEX.source, 'g');
    
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = timestampRegex.exec(text)) !== null) {
      const timestamp = match[1];
      const seconds = parseTimestamp(timestamp);
      
      if (seconds !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
          parts.push(text.slice(lastIndex, match.index));
        }
        
        // Add clickable timestamp
        parts.push(
          <button
            key={`ts-${match.index}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleTimestampClick(seconds);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="text-primary hover:text-primary/80 underline decoration-1 underline-offset-2 transition-colors cursor-pointer relative z-10"
            style={{ pointerEvents: 'auto', userSelect: 'none' }}
          >
            {match[0]}
          </button>
        );
        
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    
    return parts.length > 0 ? <>{parts}</> : text;
  };
  
  // Helper to process children nodes
  const processChildren = (children: ReactNode): ReactNode => {
    if (!children) return children;
    
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return processTextWithTimestamps(child);
      }
      return child;
    });
  };
  return (
    <div ref={scrollAreaRef} className="h-full w-full">
      <ScrollArea className="h-full w-full">
        <div className="p-6 max-w-none">
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Headings
              h1: ({ children }) => (
                <h1 className="text-2xl font-bold mb-4 mt-6 text-foreground">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-xl font-semibold mb-3 mt-5 text-foreground">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg font-semibold mb-2 mt-4 text-foreground">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-base font-semibold mb-2 mt-3 text-foreground">
                  {children}
                </h4>
              ),
              // Paragraphs
              p: ({ children }) => (
                <p className="mb-4 text-sm leading-relaxed text-foreground/90 break-words">
                  {processChildren(children)}
                </p>
              ),
              // Lists
              ul: ({ children }) => (
                <ul className="list-disc list-inside mb-4 space-y-1 text-sm text-foreground/90">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal list-inside mb-4 space-y-1 text-sm text-foreground/90">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="ml-2 text-sm leading-relaxed break-words">
                  {processChildren(children)}
                </li>
              ),
              // Blockquotes
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-primary/30 pl-4 py-2 my-4 italic bg-muted/30 rounded-r">
                  {children}
                </blockquote>
              ),
              // Code blocks
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || '');
                return match ? (
                  <pre className="bg-muted/50 p-3 rounded-lg overflow-x-auto mb-4 text-xs">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                ) : (
                  <code className="bg-muted/50 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                    {children}
                  </code>
                );
              },
              // Tables (from remark-gfm)
              table: ({ children }) => (
                <div className="overflow-x-auto mb-4">
                  <table className="min-w-full divide-y divide-border">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-muted/30">{children}</thead>
              ),
              tbody: ({ children }) => (
                <tbody className="divide-y divide-border">{children}</tbody>
              ),
              tr: ({ children }) => (
                <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
              ),
              th: ({ children }) => (
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-foreground">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-2 text-sm text-foreground/90 break-words">{processChildren(children)}</td>
              ),
              // Horizontal rules
              hr: () => (
                <hr className="my-6 border-t border-border/50" />
              ),
              // Links
              a: ({ href, children }) => {
                // Check if the link text is a timestamp
                const linkText = React.Children.toArray(children).join('');
                const seconds = parseTimestamp(linkText);
                
                if (seconds !== null && onTimestampClick) {
                  // It's a timestamp - render as a clickable button
                  return (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleTimestampClick(seconds);
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className="text-primary hover:text-primary/80 underline decoration-1 underline-offset-2 transition-colors cursor-pointer relative z-10"
                      style={{ pointerEvents: 'auto', userSelect: 'none' }}
                    >
                      {children}
                    </button>
                  );
                }
                
                // Regular external link
                return (
                  <a 
                    href={href} 
                    className="text-primary hover:text-primary/80 underline decoration-1 underline-offset-2 transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                );
              },
              // Emphasis
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">
                  {processChildren(children)}
                </strong>
              ),
              em: ({ children }) => (
                <em className="italic">
                  {processChildren(children)}
                </em>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </ScrollArea>
    </div>
  );
}