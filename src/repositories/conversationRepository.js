import { db } from '../config/database.js';

const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];

function normalizeLanguage(language, fallback = 'en') {
  const normalized = String(language || '')
    .trim()
    .toLowerCase()
    .split('-')[0];

  return supportedLanguages.includes(normalized)
    ? normalized
    : fallback;
}

export async function createConversation(
  client,
  {
    visitorId,
    leadId = null,
    language = 'en',
    metadata = {}
  }
) {
  const safeLanguage =
    normalizeLanguage(language);

  const { rows } = await client.query(
    `
      INSERT INTO conversations (
        visitor_id,
        lead_id,
        primary_language,
        languages_used,
        source,
        referrer,
        landing_page,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term
      )
      VALUES (
        $1,

        COALESCE(
          $2::uuid,
          (
            SELECT l.lead_id
            FROM leads l
            WHERE l.visitor_id = $1
            ORDER BY l.created_at DESC
            LIMIT 1
          )
        ),

        $3::language_code,
        ARRAY[$3::language_code],
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11
      )
      RETURNING *, primary_language AS language
    `,
    [
      visitorId,
      leadId,
      safeLanguage,
      metadata.source || 'website',
      metadata.referrer || null,
      metadata.landingPage || null,
      metadata.utmSource || null,
      metadata.utmMedium || null,
      metadata.utmCampaign || null,
      metadata.utmContent || null,
      metadata.utmTerm || null
    ]
  );

  return rows[0];
}

export async function getConversationWithLead(id) {
  const { rows } = await db.query(
    `
      SELECT
        c.*,
        l.*
      FROM conversations c
      LEFT JOIN leads l
        USING (lead_id)
      WHERE c.conversation_id = $1
    `,
    [id]
  );

  return rows[0] || null;
}

export async function updateConversationLanguage(
  conversationId,
  language
) {
  const safeLanguage = normalizeLanguage(language);

  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        primary_language = $2::language_code,

        languages_used =
          CASE
            WHEN $2::language_code = ANY(languages_used)
              THEN languages_used
            ELSE array_append(
              languages_used,
              $2::language_code
            )
          END,

        last_activity_at = NOW()

      WHERE conversation_id = $1

      RETURNING *, primary_language AS language
    `,
    [
      conversationId,
      safeLanguage
    ]
  );

  return rows[0] || null;
}

export async function requestConversationClose({
  conversationId
}) {
  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        conversation_stage = 'awaiting_close_confirmation',
        last_activity_at = NOW()
      WHERE conversation_id = $1
        AND conversation_status = 'open'
      RETURNING *, primary_language AS language
    `,
    [conversationId]
  );

  return rows[0] || null;
}

export async function continueConversation({
  conversationId
}) {
  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        conversation_status = 'open',
        conversation_stage = 'active',
        ended_at = NULL,
        last_activity_at = NOW()
      WHERE conversation_id = $1
        AND conversation_status IN ('open', 'completed', 'abandoned')
      RETURNING *, primary_language AS language
    `,
    [conversationId]
  );

  return rows[0] || null;
}

export async function closeConversation({
  conversationId,
  status = 'completed'
}) {
  const allowedStatuses = [
    'completed',
    'abandoned',
    'transferred'
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error('Invalid conversation status');
  }

  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        conversation_status = $1,
        conversation_stage = 'closed',
        ended_at = NOW(),
        last_activity_at = NOW()
      WHERE conversation_id = $2
        AND conversation_status = 'open'
      RETURNING *, primary_language AS language
    `,
    [
      status,
      conversationId
    ]
  );

  return rows[0] || null;
}

export function mapIntentToStage(intent) {
  const stages = {
    overview:
      'overview',

    client_info:
      'client_information',

    game_info:
      'game_information',

    technical_privacy:
      'technical_privacy',

    trial:
      'trial_interest',

    welcome:
      'welcome',

    conversation_completed:
      'closed',

    conversation_abandoned:
      'closed'
  };

  return stages[intent] ||
    'discovery';
}


export async function updateConversationAnalysis({
  conversationId,
  summary,
  interests = [],
  needs = [],
  objections = [],
  nextBestAction = null,
  outcome = null
}) {
  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        conversation_summary = $2,
        interests_discovered = $3::jsonb,
        needs_discovered = $4::jsonb,
        objections_discovered = $5::jsonb,
        next_best_action = $6,
        conversation_outcome = $7,
        summary_updated_at = NOW()
      WHERE conversation_id = $1
      RETURNING *, primary_language AS language
    `,
    [
      conversationId,
      summary || null,
      JSON.stringify(interests),
      JSON.stringify(needs),
      JSON.stringify(objections),
      nextBestAction,
      outcome
    ]
  );

  return rows[0] || null;
}

export async function updateConversationOutcome({
  conversationId,
  outcome,
  stage = 'completed'
}) {
  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        conversation_outcome = $2,
        conversation_stage = $3,
        last_activity_at = NOW()
      WHERE conversation_id = $1
      RETURNING *, primary_language AS language
    `,
    [
      conversationId,
      outcome || null,
      stage
    ]
  );

  return rows[0] || null;
}

export async function updateConversationIntent({
  conversationId,
  intent,
  stage = null
}) {
  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        detected_intent = $2,

        conversation_stage =
          COALESCE(
            $3,
            conversation_stage
          ),

        last_activity_at = now()

      WHERE conversation_id = $1

      RETURNING *
    `,
    [
      conversationId,
      intent || null,
      stage
    ]
  );

  return rows[0] || null;
}

export async function updateConversationStage(
  conversationId,
  stage
) {
  const { rows } = await db.query(
    `
      UPDATE conversations
      SET
        conversation_stage = $2,
        last_activity_at = now()
      WHERE conversation_id = $1
      RETURNING *
    `,
    [
      conversationId,
      stage
    ]
  );

  return rows[0] || null;
}

export async function findOpenConversationForVisitor({
  conversationId,
  visitorCookieId
}) {
  const { rows } = await db.query(
    `
      SELECT c.*
      FROM conversations c
      INNER JOIN visitors v
        ON v.visitor_id = c.visitor_id
      WHERE c.conversation_id = $1
        AND v.cookie_id = $2
        AND c.conversation_status = 'open'
      LIMIT 1
    `,
    [conversationId, visitorCookieId]
  );

  return rows[0] || null;
}

export async function findReusableOpenConversation(
  client,
  {
    visitorId
  }
) {
  const { rows } =
    await client.query(
      `
        SELECT
          *,
          primary_language AS language

        FROM conversations

        WHERE visitor_id = $1
          AND conversation_status = 'open'
          AND last_activity_at >
              NOW() - INTERVAL '30 minutes'

        ORDER BY last_activity_at DESC

        LIMIT 1
      `,
      [visitorId]
    );

  return rows[0] || null;
}
