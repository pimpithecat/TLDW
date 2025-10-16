'use client';

import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { NoteWithVideo, NoteSource } from '@/lib/types';
import { fetchAllNotes, deleteNote } from '@/lib/notes-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Search, Trash2, Video, NotebookPen, Loader2 } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function getSourceLabel(source: NoteSource) {
  switch (source) {
    case 'chat':
      return 'AI Message';
    case 'takeaways':
      return 'Takeaways';
    case 'transcript':
      return 'Transcript';
    default:
      return 'Custom';
  }
}

function getSourceColor(source: NoteSource) {
  switch (source) {
    case 'chat':
      return 'bg-blue-100 text-blue-700';
    case 'takeaways':
      return 'bg-green-100 text-green-700';
    case 'transcript':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

const markdownComponents = {
  p: ({ children }: { children: ReactNode }) => (
    <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
  ),
  ul: ({ children }: { children: ReactNode }) => (
    <ul className="list-disc list-inside space-y-1 mb-2 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children: ReactNode }) => (
    <ol className="list-decimal list-inside space-y-1 mb-2 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children: ReactNode }) => (
    <li className="whitespace-pre-wrap">{children}</li>
  ),
  a: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a
      href={href}
      className="text-primary hover:text-primary/80 underline decoration-1 underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  code: ({ children }: { children: ReactNode }) => (
    <code className="bg-background/80 px-1 py-0.5 rounded text-xs">{children}</code>
  ),
  pre: ({ children }: { children: ReactNode }) => (
    <pre className="bg-background/70 p-3 rounded-lg overflow-x-auto text-xs space-y-2">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children: ReactNode }) => (
    <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic">{children}</blockquote>
  ),
  strong: ({ children }: { children: ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children: ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  h1: ({ children }: { children: ReactNode }) => (
    <h1 className="text-base font-semibold mb-2">{children}</h1>
  ),
  h2: ({ children }: { children: ReactNode }) => (
    <h2 className="text-sm font-semibold mb-1">{children}</h2>
  ),
  h3: ({ children }: { children: ReactNode }) => (
    <h3 className="text-sm font-medium mb-1">{children}</h3>
  ),
};

export default function AllNotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteWithVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<NoteSource | 'all'>('all');

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    try {
      setLoading(true);
      setError(null);
      const fetchedNotes = await fetchAllNotes();
      setNotes(fetchedNotes);
    } catch (err) {
      console.error('Error loading notes:', err);
      if (err instanceof Error && err.message.includes('401')) {
        // Redirect to home if not authenticated
        router.push('/');
      } else {
        setError('Failed to load notes. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await deleteNote(noteId);
      setNotes(prev => prev.filter(note => note.id !== noteId));
    } catch (err) {
      console.error('Error deleting note:', err);
      alert('Failed to delete note. Please try again.');
    }
  }

  // Group notes by video
  const groupedNotes = useMemo(() => {
    const filtered = notes.filter(note => {
      const matchesSearch = searchQuery.trim() === '' ||
        note.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.video?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.video?.author.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSource = filterSource === 'all' || note.source === filterSource;

      return matchesSearch && matchesSource;
    });

    const grouped = filtered.reduce<Record<string, { video: NoteWithVideo['video'], notes: NoteWithVideo[] }>>((acc, note) => {
      const videoId = note.video?.youtubeId || 'unknown';
      if (!acc[videoId]) {
        acc[videoId] = {
          video: note.video,
          notes: []
        };
      }
      acc[videoId].notes.push(note);
      return acc;
    }, {});

    return grouped;
  }, [notes, searchQuery, filterSource]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="text-center py-12">
          <p className="text-lg text-destructive mb-4">{error}</p>
          <Button onClick={loadNotes}>Try Again</Button>
        </div>
      </div>
    );
  }

  const totalNotes = notes.length;
  const filteredCount = Object.values(groupedNotes).reduce((sum, group) => sum + group.notes.length, 0);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <NotebookPen className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold">My Notes</h1>
        </div>
        <p className="text-muted-foreground">
          All your notes from analyzed videos in one place. {totalNotes} {totalNotes === 1 ? 'note' : 'notes'} total.
        </p>
      </div>

      {/* Search and Filter */}
      {totalNotes > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search notes or videos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={filterSource === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterSource('all')}
            >
              All
            </Button>
            <Button
              variant={filterSource === 'chat' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterSource('chat')}
            >
              Chat
            </Button>
            <Button
              variant={filterSource === 'transcript' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterSource('transcript')}
            >
              Transcript
            </Button>
            <Button
              variant={filterSource === 'takeaways' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterSource('takeaways')}
            >
              Takeaways
            </Button>
          </div>
        </div>
      )}

      {/* Notes Content */}
      {totalNotes === 0 ? (
        <div className="text-center py-12">
          <NotebookPen className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-lg text-muted-foreground mb-4">
            You haven't saved any notes yet.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Highlight text from transcripts or chat messages to create notes while analyzing videos.
          </p>
          <Link href="/">
            <Button>
              Analyze a Video
            </Button>
          </Link>
        </div>
      ) : filteredCount === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground">
            No notes match your search or filter.
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-300px)]">
          <div className="space-y-8">
            {Object.entries(groupedNotes).map(([videoId, { video, notes: videoNotes }]) => (
              <div key={videoId} className="space-y-4">
                {/* Video Header */}
                <Link href={`/analyze/${videoId}`}>
                  <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="flex gap-4">
                      {video?.thumbnailUrl && (
                        <div className="relative w-40 h-24 flex-shrink-0 rounded overflow-hidden bg-muted">
                          <Image
                            src={video.thumbnailUrl}
                            alt={video.title}
                            fill
                            className="object-cover"
                            sizes="160px"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg line-clamp-1 mb-1">
                          {video?.title || 'Unknown Video'}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                          {video?.author || 'Unknown Author'}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {video?.duration && (
                            <span>{formatDuration(video.duration)}</span>
                          )}
                          <span>{videoNotes.length} {videoNotes.length === 1 ? 'note' : 'notes'}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>

                {/* Notes List */}
                <div className="space-y-2.5 pl-4">
                  {videoNotes.map((note) => {
                    const selectedText = note.metadata?.selectedText?.trim();
                    const text = note.text ?? '';

                    let quoteText = '';
                    let additionalText = '';

                    if (selectedText) {
                      quoteText = selectedText;
                      if (text.startsWith(selectedText)) {
                        additionalText = text.slice(selectedText.length).trimStart();
                      } else if (text !== selectedText) {
                        additionalText = text;
                      }
                    } else {
                      const parts = text.split(/\n{2,}/);
                      quoteText = parts[0] ?? '';
                      additionalText = parts.slice(1).join('\n\n');
                    }

                    return (
                      <Card key={note.id} className="group p-3.5 bg-white hover:bg-neutral-50/60 border-none shadow-none transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-2">
                            {/* Source Badge */}
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide ${getSourceColor(note.source)}`}>
                                {getSourceLabel(note.source)}
                              </span>
                              {note.metadata?.timestampLabel && (
                                <span className="text-[10px] text-muted-foreground">
                                  {note.metadata.timestampLabel}
                                </span>
                              )}
                            </div>

                            {/* Note Content */}
                            {quoteText && (
                              <div className="border-l-2 border-primary/40 pl-3 py-1 rounded-r text-sm text-foreground/90 leading-relaxed">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={markdownComponents}
                                >
                                  {quoteText}
                                </ReactMarkdown>
                              </div>
                            )}
                            {additionalText && (
                              <div className="text-sm leading-relaxed text-foreground">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={markdownComponents}
                                >
                                  {additionalText}
                                </ReactMarkdown>
                              </div>
                            )}

                            {/* Timestamp */}
                            <div className="text-[11px] text-muted-foreground">
                              {new Date(note.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>

                          {/* Delete Button */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteNote(note.id)}
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <span className="text-xs">Delete note</span>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
      </div>
    </TooltipProvider>
  );
}
