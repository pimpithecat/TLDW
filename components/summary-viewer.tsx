"use client";

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from "@/components/ui/scroll-area";

interface SummaryViewerProps {
  content: string;
}

export function SummaryViewer({ content }: SummaryViewerProps) {
  return (
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
                <p className="mb-4 text-sm leading-relaxed text-foreground/90">
                  {children}
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
                <li className="ml-2 text-sm leading-relaxed">
                  {children}
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
                <td className="px-3 py-2 text-sm text-foreground/90">{children}</td>
              ),
              // Horizontal rules
              hr: () => (
                <hr className="my-6 border-t border-border/50" />
              ),
              // Links
              a: ({ href, children }) => (
                <a 
                  href={href} 
                  className="text-primary hover:text-primary/80 underline decoration-1 underline-offset-2 transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              // Emphasis
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">
                  {children}
                </strong>
              ),
              em: ({ children }) => (
                <em className="italic">
                  {children}
                </em>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </ScrollArea>
  );
}