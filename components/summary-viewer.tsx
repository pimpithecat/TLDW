"use client";

import React, { ReactNode, useRef, useCallback, useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseTimestamp, TIMESTAMP_REGEX } from "@/lib/timestamp-utils";
import { ChevronDown, Copy, RefreshCw, Check, SquarePen } from "lucide-react";
import { TimestampButton } from "./timestamp-button";
import type { NoteMetadata, NoteSource } from "@/lib/types";

interface SummaryViewerProps {
  content: string;
  onTimestampClick?: (seconds: number) => void;
  collapsibleSections?: boolean;
  onRetry?: () => void;
  showActions?: boolean;
  onSaveNote?: (payload: { text: string; source: NoteSource; sourceId?: string | null; metadata?: NoteMetadata | null }) => Promise<void>;
}

interface Section {
  id: string;
  title: string;
  content: string;
  level: number;
}

export function SummaryViewer({ content, onTimestampClick, collapsibleSections = true, onRetry, showActions = false, onSaveNote }: SummaryViewerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const handleSaveNote = useCallback(() => {
    if (!onSaveNote) {
      return;
    }
    void onSaveNote({
      text: content,
      source: "takeaways",
      sourceId: null,
    });
  }, [onSaveNote, content]);

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [content]);

  // Handle retry
  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    }
  }, [onRetry]);
  
  // Parse content into sections based on h2 headings
  const sections = useMemo(() => {
    const lines = content.split('\n');
    const sectionList: Section[] = [];
    let currentSection: Section | null = null;
    let contentLines: string[] = [];
    
    for (const line of lines) {
      // Check if line is an h2 heading (## )
      if (line.startsWith('## ')) {
        // Save previous section if exists
        if (currentSection) {
          currentSection.content = contentLines.join('\n').trim();
          if (currentSection.content) {
            sectionList.push(currentSection);
          }
        }
        
        // Start new section
        const title = line.substring(3).trim();
        const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        currentSection = {
          id,
          title,
          content: '',
          level: 2
        };
        contentLines = [];
      } else if (currentSection) {
        // Add line to current section's content
        contentLines.push(line);
      } else {
        // Content before first section - create an intro section
        if (!sectionList.length && !currentSection) {
          currentSection = {
            id: 'intro',
            title: '',
            content: '',
            level: 0
          };
          contentLines = [line];
        } else {
          contentLines.push(line);
        }
      }
    }
    
    // Save last section
    if (currentSection) {
      currentSection.content = contentLines.join('\n').trim();
      if (currentSection.content || currentSection.title) {
        sectionList.push(currentSection);
      }
    }
    
    return sectionList;
  }, [content]);
  
  // Initialize collapsed state for all sections (default to collapsed except intro)
  useEffect(() => {
    if (!collapsibleSections) return;
    const initial: Record<string, boolean> = {};
    sections.forEach(section => {
      initial[section.id] = section.id !== 'intro';
    });
    setCollapsedSections(initial);
  }, [sections, collapsibleSections]);
  
  // Get the actual scroll viewport element
  const getScrollViewport = useCallback(() => {
    if (scrollAreaRef.current) {
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
      requestAnimationFrame(() => {
        restoreScrollPosition();
      });
    }
  }, [onTimestampClick, saveScrollPosition, restoreScrollPosition]);
  
  // Toggle section collapse state
  const toggleSection = useCallback((sectionId: string) => {
    if (!collapsibleSections) return;
    setCollapsedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  }, [collapsibleSections]);
  
  // Process text to make timestamps clickable
  const processTextWithTimestamps = (text: string | ReactNode): ReactNode => {
    if (!onTimestampClick || typeof text !== 'string') return text;
    
    const timestampRegex = new RegExp(TIMESTAMP_REGEX.source, 'g');
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = timestampRegex.exec(text)) !== null) {
      const timestamp = match[1];
      const seconds = parseTimestamp(timestamp);
      
      if (seconds !== null) {
        // Add text before the match, but skip brackets and commas
        if (match.index > lastIndex) {
          let textBefore = text.slice(lastIndex, match.index);
          // Remove trailing opening brackets or commas from the text before
          textBefore = textBefore.replace(/[\[(,\s]+$/, '');
          if (textBefore) {
            parts.push(textBefore);
          }
        }
        
        // Don't add prefix characters (brackets, commas) - they're being removed
        
        parts.push(
          <span key={`ts-${match.index}`} className="inline-block mx-1 align-baseline">
            <TimestampButton
              timestamp={timestamp}
              seconds={seconds}
              onClick={handleTimestampClick}
              className="text-[11px]"
            />
          </span>
        );
        
        // Move past the entire match including any suffix characters
        lastIndex = match.index + match[0].length;
        
        // Check if the next characters are closing brackets or commas and skip them
        while (lastIndex < text.length && /[\]),\s]/.test(text[lastIndex])) {
          // Skip spaces after commas, but preserve other spaces
          if (text[lastIndex] === ' ' && lastIndex > 0 && text[lastIndex - 1] !== ',') {
            break;
          }
          lastIndex++;
        }
      }
    }
    
    if (lastIndex < text.length) {
      let remainingText = text.slice(lastIndex);
      // Clean up any leading brackets or commas
      remainingText = remainingText.replace(/^[\]),\s]+/, '');
      if (remainingText) {
        parts.push(remainingText);
      }
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
  
  // Markdown components configuration
  const markdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-bold mb-4 mt-6 text-foreground">
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-semibold mb-3 mt-5 text-foreground">
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-semibold mb-2 mt-4 text-foreground">
        {children}
      </h3>
    ),
    h4: ({ children }: any) => (
      <h4 className="text-base font-semibold mb-2 mt-3 text-foreground">
        {children}
      </h4>
    ),
    p: ({ children }: any) => (
      <p className="mb-4 text-sm leading-relaxed text-foreground/90 break-words">
        {processChildren(children)}
      </p>
    ),
    ul: ({ children }: any) => (
      <ul className="list-disc list-inside mb-4 space-y-1 text-sm text-foreground/90">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal list-inside mb-4 space-y-1 text-sm text-foreground/90">
        {children}
      </ol>
    ),
    li: ({ children }: any) => (
      <li className="ml-2 text-sm leading-relaxed break-words">
        {processChildren(children)}
      </li>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-primary/30 pl-4 py-2 my-4 italic bg-muted/30 rounded-r">
        {children}
      </blockquote>
    ),
    code: ({ className, children, ...props }: any) => {
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
    table: ({ children }: any) => (
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full divide-y divide-border">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-muted/30">{children}</thead>
    ),
    tbody: ({ children }: any) => (
      <tbody className="divide-y divide-border">{children}</tbody>
    ),
    tr: ({ children }: any) => (
      <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
    ),
    th: ({ children }: any) => (
      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-foreground">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="px-3 py-2 text-sm text-foreground/90 break-words">
        {processChildren(children)}
      </td>
    ),
    hr: () => (
      <hr className="my-6 border-t border-border/50" />
    ),
    a: ({ href, children }: any) => {
      const linkText = React.Children.toArray(children).join('');
      const seconds = parseTimestamp(linkText);
      
      if (seconds !== null && onTimestampClick) {
        return (
          <span className="inline-block mx-1 align-baseline">
            <TimestampButton
              timestamp={linkText}
              seconds={seconds}
              onClick={handleTimestampClick}
              className="text-[11px]"
            />
          </span>
        );
      }
      
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
    strong: ({ children }: any) => (
      <strong className="font-semibold text-foreground">
        {processChildren(children)}
      </strong>
    ),
    em: ({ children }: any) => (
      <em className="italic">
        {processChildren(children)}
      </em>
    ),
  };
  
  if (!collapsibleSections) {
    return (
      <div ref={scrollAreaRef} className="space-y-3">
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </article>
        
        {/* Action buttons */}
        {showActions && (
          <div className="flex items-center gap-0 mt-2 mb-3">
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

            {onSaveNote && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSaveNote}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <SquarePen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Save note</p>
                </TooltipContent>
              </Tooltip>
            )}
            
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
        )}
      </div>
    );
  }

  return (
    <div ref={scrollAreaRef} className="h-full w-full">
      <ScrollArea className="h-full w-full">
        <div className="p-6 max-w-none">
          <article className="prose prose-sm dark:prose-invert max-w-none">
            {sections.map((section) => {
              const isCollapsed = collapsedSections[section.id] ?? (section.id !== 'intro');
              
              // For intro section without title
              if (section.id === 'intro' && !section.title) {
                return (
                  <div key={section.id}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {section.content}
                    </ReactMarkdown>
                  </div>
                );
              }
              
              return (
                <div key={section.id} className="mb-2">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    className="group flex items-center gap-2 w-full text-xl font-semibold mb-3 mt-5 text-foreground hover:text-primary/90 transition-all cursor-pointer"
                    aria-expanded={!isCollapsed}
                    aria-controls={`section-${section.id}`}
                  >
                    <ChevronDown 
                      className={`w-5 h-5 transition-transform duration-200 flex-shrink-0 ${
                        isCollapsed ? '' : 'rotate-180'
                      }`}
                    />
                    <span className="text-left">{section.title}</span>
                  </button>
                  <div 
                    id={`section-${section.id}`}
                    className={`transition-all duration-300 ease-in-out ${
                      isCollapsed 
                        ? 'max-h-0 overflow-hidden opacity-0' 
                        : 'max-h-none overflow-visible opacity-100'
                    }`}
                  >
                    <div className={`${isCollapsed ? '' : 'pb-4'}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {section.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}
          </article>
        </div>
      </ScrollArea>
    </div>
  );
}
