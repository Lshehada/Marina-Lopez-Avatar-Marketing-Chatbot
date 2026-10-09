import { openai } from '../config/openai.js';
import { config } from '../config/index.js';

const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];

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

function isAmbiguousMessage(text) {
  const normalized = String(text || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return true;
  }

  const ambiguousMessages = new Set([
    'ok',
    'okay',
    'yes',
    'no',
    'thanks',
    'thank you',
    'merci',
    'oui',
    'non',
    'ja',
    'nein',
    'si',
    'sí',
    '👍',
    '👎'
  ]);

  return (
    normalized.length < 3 ||
    ambiguousMessages.has(normalized)
  );
}

export async function detectMessageLanguage({
  text,
  fallbackLanguage = 'en'
}) {
  const safeFallback = normalizeLanguage(
    fallbackLanguage
  );

  const message = String(text || '').trim();

  if (!message) {
    return safeFallback;
  }

  if (isAmbiguousMessage(message)) {
    return safeFallback;
  }

  try {
    const response = await openai.responses.create({
      model: config.OPENAI_MODEL,

      instructions: `
You are a language classifier.

Detect the primary language of the user's message.

Supported languages:
- en = English
- de = German
- it = Italian
- es = Spanish
- fr = French

Return exactly one of these codes:
en
de
it
es
fr

Return only the language code.
Do not add punctuation, Markdown, or explanation.

If the message is genuinely ambiguous, return:
${safeFallback}
      `.trim(),

      input: message,

      max_output_tokens: 16,

      store: false
    });

    const rawResult = String(
      response.output_text || ''
    )
      .trim()
      .toLowerCase();

    console.log(
      'Language detection:',
      JSON.stringify({
        message,
        rawResult,
        fallback: safeFallback
      })
    );

    return normalizeLanguage(
      rawResult,
      safeFallback
    );
  } catch (error) {
    console.error(
      'Message language detection failed:',
      error.message
    );

    return safeFallback;
  }
}