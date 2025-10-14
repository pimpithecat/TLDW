"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ThemeSelectorProps {
  themes: string[];
  selectedTheme: string | null;
  onSelect: (theme: string | null) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ThemeSelector({
  themes,
  selectedTheme,
  onSelect,
  isLoading = false,
  error = null,
}: ThemeSelectorProps) {
  const displayThemes = themes.slice(0, 3);
  const hasThemes = displayThemes.length > 0;

  const handleThemeClick = (theme: string) => {
    if (selectedTheme === theme) {
      onSelect(null);
    } else {
      onSelect(theme);
    }
  };

  return (
    <Card className="border bg-background/80 backdrop-blur-sm p-3 shadow-none">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Explore by theme
        </span>
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {hasThemes ? (
          displayThemes.map((theme) => (
            <Button
              key={theme}
              variant={selectedTheme === theme ? "default" : "outline"}
              size="sm"
              className={cn(
                "rounded-full px-3 py-1 text-sm transition-all",
                selectedTheme === theme
                  ? "shadow-sm"
                  : "bg-muted/40 hover:bg-muted"
              )}
              onClick={() => handleThemeClick(theme)}
            >
              {theme}
            </Button>
          ))
        ) : (
          !isLoading && (
            <span className="text-sm text-muted-foreground">
              Themes will appear here shortly.
            </span>
          )
        )}
      </div>

      {(selectedTheme || error) && (
        <div className="mt-3 space-y-1">
          {selectedTheme && (
            <p className="text-xs text-muted-foreground">
              Showing highlights for{" "}
              <span className="font-medium text-foreground">{selectedTheme}</span>
            </p>
          )}
          {error && (
            <p className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {selectedTheme && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onSelect(null)}
        >
          Clear theme
        </Button>
      )}
    </Card>
  );
}
