import { db } from '../config/database.js';

const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];

function normalizeLanguage(
  language,
  fallback = 'en'
) {
  const normalized =
    String(language || '')
      .trim()
      .toLowerCase()
      .split('-')[0];

  return supportedLanguages.includes(normalized)
    ? normalized
    : fallback;
}

export async function saveMessage(data) {
  const safeLanguage =
    normalizeLanguage(data.language);

  const { rows } = await db.query(
    `
      INSERT INTO messages (
        conversation_id,
        sender_role,
        message_text,
        language,
        message_classification,
        intent,
        model_used,
        token_count,
        response_time_ms,
        openai_response_id,
        prompt_mode
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11
      )
      RETURNING *
    `,
    [
      data.conversationId,
      data.senderRole,
      data.text,
      safeLanguage,
      data.messageClassification || null,
      data.intent || null,
      data.modelUsed || null,
      data.tokenCount ?? null,
      data.responseTimeMs ?? null,
      data.openaiResponseId || null,
      data.promptMode || null
    ]
  );

  /*
   * Every saved message counts as conversation activity.
   */
  await db.query(
    `
      UPDATE conversations
      SET last_activity_at = now()
      WHERE conversation_id = $1
    `,
    [data.conversationId]
  );

  return rows[0];
}

export async function getRecentMessages(
  conversationId,
  limit = 20
) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || 20, 1),
    100
  );

  const { rows } = await db.query(
    `
      SELECT
        sender_role,
        message_text,
        language,
        intent,
        prompt_mode
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [
      conversationId,
      safeLimit
    ]
  );

  return rows.reverse();
}

export async function getVisitorHistory(
  conversationId
) {
  const { rows } = await db.query(
    `
      SELECT
        sender_role,
        message_text,
        language,
        intent,
        prompt_mode,
        created_at
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
    `,
    [conversationId]
  );

  return rows;
}