import { openai } from '../config/openai.js';
import { config } from '../config/index.js';

const languageNames = {
  en: 'English',
  de: 'German',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French'
};

export async function createChatResponse({
  instructions,
  history,
  language = 'en',
  useFileSearch = false,
  knowledgeCategory = null
}) {
  const responseLanguage =
    languageNames[language] ||
    languageNames.en;

  const finalInstructions = `
${instructions}

MANDATORY RESPONSE LANGUAGE:

Detect the language of the latest visitor message and reply entirely
in that language.

Supported languages are English, German, Italian, Spanish, and French.

The saved conversation language is ${responseLanguage}. Use it only
as a fallback for short or ambiguous messages such as “Yes”, “No”,
“Okay”, or “Thanks”.

Always use the language of the latest user message, even if:
- previous messages used another language
- the welcome message used another language
- retrieved documents are written in another language
- customer data is written in another language
- the main prompt is written in English

Do not mention language detection.
Do not translate the user's question unless necessary.
`.trim();

  const request = {
    model: config.OPENAI_MODEL,

    instructions: finalInstructions,

    max_output_tokens: 220,

    input: history.map((message) => ({
      role:
        message.sender_role === 'visitor'
          ? 'user'
          : 'assistant',

      content: message.message_text
    })),

    store: false
  };

  if (useFileSearch) {
    const vectorStoreId =
      config.OPENAI_VECTOR_STORE_ID.trim();

    const fileSearchTool = {
      type: 'file_search',

      vector_store_ids: [
        vectorStoreId
      ],

      max_num_results: 4
    };

    /*
     * Search only the correct category:
     * client, game, technical_privacy, or overview.
     */
    if (knowledgeCategory) {
      fileSearchTool.filters = {
        type: 'eq',
        key: 'category',
        value: knowledgeCategory
      };
    }

    request.tools = [
      fileSearchTool
    ];

    request.include = [
      'file_search_call.results'
    ];
  }

  return openai.responses.create(request);
}