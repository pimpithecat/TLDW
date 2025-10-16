import { useMemo } from "react";
import { Note, NoteSource } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, Clock } from "lucide-react";

interface NotesPanelProps {
  notes?: Note[];
  onDeleteNote?: (noteId: string) => Promise<void>;
}

function getSourceLabel(source: NoteSource) {
  switch (source) {
    case "chat":
      return "AI Message";
    case "takeaways":
      return "Takeaways";
    case "transcript":
      return "Transcript";
    default:
      return "Custom";
  }
}

export function NotesPanel({ notes = [], onDeleteNote }: NotesPanelProps) {
  const groupedNotes = useMemo(() => {
    return notes.reduce<Record<NoteSource, Note[]>>((acc, note) => {
      const list = acc[note.source] || [];
      list.push(note);
      acc[note.source] = list;
      return acc;
    }, {} as Record<NoteSource, Note[]>);
  }, [notes]);

  if (!notes.length) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
        Your saved notes will appear here. Highlight transcript or chat text to take a note.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        {Object.entries(groupedNotes).map(([source, sourceNotes]) => (
          <div key={source} className="space-y-3">
            <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {getSourceLabel(source as NoteSource)}
            </div>
            <div className="space-y-2.5">
              {sourceNotes.map((note) => (
                <Card key={note.id} className="p-3.5 bg-neutral-50/60 border-none shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                        {note.text}
                      </p>
                      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-3">
                          {note.metadata?.selectionContext && (
                            <span className="truncate" title={note.metadata.selectionContext}>
                              {note.metadata.selectionContext}
                            </span>
                          )}
                          {note.metadata?.timestampLabel && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {note.metadata.timestampLabel}
                            </span>
                          )}
                          <span>
                            {new Date(note.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {note.metadata?.transcript?.segmentIndex !== undefined && (
                          <span className="text-muted-foreground/80">
                            Segment #{note.metadata.transcript.segmentIndex + 1}
                          </span>
                        )}
                      </div>
                    </div>
                    {onDeleteNote && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDeleteNote(note.id)}
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span className="text-xs">Delete note</span>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
