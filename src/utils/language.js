/**
 * Languages currently supported by Marina.
 *
 * Keep this list synchronized with:
 * - sessionController.js
 * - languageService.js
 * - identityService.js
 * - PostgreSQL language_code enum
 * - frontend browser-language detection
 */
export const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];

/**
 * Human-readable language names used inside prompts.
 */
export const languageNames = {
  en: 'English',
  de: 'German',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French'
};

/**
 * Converts browser language values such as fr-FR or de-DE
 * into the application's two-letter language codes.
 */
export function normalizeLanguage(
  language,
  fallback = 'en'
) {
  const normalized = String(language || '')
    .trim()
    .toLowerCase()
    .split('-')[0];

  return supportedLanguages.includes(normalized)
    ? normalized
    : fallback;
}