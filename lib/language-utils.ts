// Language-related utilities and constants

export const SUPPORTED_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Russian',
  'Japanese',
  'Korean',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Arabic',
  'Hindi'
] as const;

export type Language = typeof SUPPORTED_LANGUAGES[number];

export interface LanguageInfo {
  id: Language;
  name: string;
  nativeName: string;
}

export const LANGUAGE_INFO: LanguageInfo[] = [
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

// RTL languages that need special handling
export const RTL_LANGUAGES: Language[] = ['Arabic', 'Hebrew'] as Language[];

// Validate if a language is supported
export function isValidLanguage(language: unknown): language is Language {
  return typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language as Language);
}

// Get language info by ID
export function getLanguageInfo(languageId: Language): LanguageInfo | undefined {
  return LANGUAGE_INFO.find(lang => lang.id === languageId);
}

// Check if language requires RTL layout
export function isRTLLanguage(language: Language): boolean {
  return RTL_LANGUAGES.includes(language);
}