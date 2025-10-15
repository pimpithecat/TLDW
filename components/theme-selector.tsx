"use client";

import { Button } from "@/components/ui/button";
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
  const isOverallSelected = selectedTheme === null;

  const buttonClasses = (isActive: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-sm transition-colors",
      isActive
        ? "bg-primary text-primary-foreground shadow-sm"
        : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60"
    );

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          className={buttonClasses(isOverallSelected)}
          onClick={() => onSelect(null)}
        >
          Overall highlights
        </Button>
        {hasThemes && displayThemes.map((theme) => (
          <Button
            key={theme}
            type="button"
            size="sm"
            className={buttonClasses(selectedTheme === theme)}
            onClick={() => onSelect(selectedTheme === theme ? null : theme)}
          >
            {theme}
          </Button>
        ))}
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}
    </div>
  );
}
