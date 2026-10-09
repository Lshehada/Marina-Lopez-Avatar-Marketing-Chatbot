import { db } from '../config/database.js';

export async function createAvatarSession({
  avatarSessionId,
  conversationId,
  customLlmApiKeyHash,
  liveAvatarLlmConfigurationId
}) {
  const { rows } = await db.query(
    `
      INSERT INTO avatar_sessions (
        avatar_session_id,
        conversation_id,
        custom_llm_api_key_hash,
        liveavatar_llm_configuration_id
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [
      avatarSessionId,
      conversationId,
      customLlmApiKeyHash,
      liveAvatarLlmConfigurationId
    ]
  );

  return rows[0];
}

export async function findActiveAvatarSessionByKeyHash(
  customLlmApiKeyHash
) {
  const { rows } = await db.query(
    `
      SELECT
        avatar_session_id,
        conversation_id,
        provider
      FROM avatar_sessions
      WHERE custom_llm_api_key_hash = $1
        AND ended_at IS NULL
      LIMIT 1
    `,
    [customLlmApiKeyHash]
  );

  return rows[0] || null;
}

export async function endAvatarSession({
  avatarSessionId,
  endReason = null
}) {
  const { rows } = await db.query(
    `
      UPDATE avatar_sessions
      SET
        ended_at = NOW(),
        end_reason = $2
      WHERE avatar_session_id = $1
        AND ended_at IS NULL
      RETURNING *
    `,
    [avatarSessionId, endReason]
  );

  return rows[0] || null;
}