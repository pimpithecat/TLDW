'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type Language = 
  | 'English'
  | 'Spanish'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Portuguese'
  | 'Dutch'
  | 'Russian'
  | 'Japanese'
  | 'Korean'
  | 'Chinese (Simplified)'
  | 'Chinese (Traditional)'
  | 'Arabic'
  | 'Hindi';

interface LanguageInfo {
  id: Language;
  name: string;
  nativeName: string;
}

const languageInfo: LanguageInfo[] = [
  { id: 'English', name: 'English', nativeName: 'English' },
  { id: 'Spanish', name: 'Spanish', nativeName: 'Español' },
  { id: 'French', name: 'French', nativeName: 'Français' },
  { id: 'German', name: 'German', nativeName: 'Deutsch' },
  { id: 'Italian', name: 'Italian', nativeName: 'Italiano' },
  { id: 'Portuguese', name: 'Portuguese', nativeName: 'Português' },
  { id: 'Dutch', name: 'Dutch', nativeName: 'Nederlands' },
  { id: 'Russian', name: 'Russian', nativeName: 'Русский' },
  { id: 'Japanese', name: 'Japanese', nativeName: '日本語' },
  { id: 'Korean', name: 'Korean', nativeName: '한국어' },
  { id: 'Chinese (Simplified)', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { id: 'Chinese (Traditional)', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { id: 'Arabic', name: 'Arabic', nativeName: 'العربية' },
  { id: 'Hindi', name: 'Hindi', nativeName: 'हिन्दी' },
];

interface LanguageSelectorProps {
  value: Language;
  onChange: (value: Language) => void;
  disabled?: boolean;
}

export function LanguageSelector({ value, onChange, disabled }: LanguageSelectorProps) {
  const selectedLanguage = languageInfo.find(l => l.id === value);

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select a language" />
        </SelectTrigger>
        <SelectContent>
          {languageInfo.map((lang) => (
            <SelectItem key={lang.id} value={lang.id}>
              <span className="flex items-center justify-between w-full">
                <span>{lang.name}</span>
                {lang.nativeName !== lang.name && (
                  <span className="text-muted-foreground ml-2">{lang.nativeName}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-2">
              <p className="font-semibold">Summary Language</p>
              <p className="text-sm">
                The video summary will be generated in {selectedLanguage?.nativeName || value}.
              </p>
              <p className="text-sm text-muted-foreground">
                Note: The original transcript language detection and translation quality may vary 
                depending on the source video's audio clarity and the target language.
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}