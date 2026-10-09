import { db } from '../config/database.js';
import { isBusinessEmail } from '../utils/email.js';

/**
 * Creates or updates a lead associated with an SDR contact.
 */
export async function upsertSdrLead(
  client,
  visitorId,
  sdr
) {
  const { rows } = await client.query(
    `
      INSERT INTO leads (
        visitor_id,
        sdr_contact_id,
        sdr_company_id,
        source_type,
        contact_name,
        email,
        email_domain,
        is_business_email,
        email_captured_at,
        company_name,
        country,
        language,
        main_interest,
        lead_status,
        last_interaction_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'sdr',
        $4,
        LOWER($5),
        SPLIT_PART(LOWER($5), '@', 2),
        $6,
        NOW(),
        $7,
        $8,
        $9::language_code,
        $10,
        'known_lead',
        NOW()
      )

      ON CONFLICT (sdr_contact_id)
      DO UPDATE SET
        visitor_id =
          EXCLUDED.visitor_id,

        sdr_company_id =
          EXCLUDED.sdr_company_id,

        contact_name =
          EXCLUDED.contact_name,

        email =
          EXCLUDED.email,

        email_domain =
          EXCLUDED.email_domain,

        is_business_email =
          EXCLUDED.is_business_email,

        company_name =
          EXCLUDED.company_name,

        country =
          EXCLUDED.country,

        language =
          EXCLUDED.language,

        main_interest =
          EXCLUDED.main_interest,

        lead_status =
          CASE
            WHEN leads.lead_status = 'known_lead'
              THEN 'engaged_lead'
            ELSE leads.lead_status
          END,

        last_interaction_at = NOW()

      RETURNING *
    `,
    [
      visitorId,
      sdr.sdr_contact_id,
      sdr.sdr_company_id,
      sdr.contact_person_name,
      sdr.contact_person_email,
      isBusinessEmail(
        sdr.contact_person_email
      ),
      sdr.company_name,
      sdr.company_location,
      sdr.preferred_language || 'en',
      sdr.area_of_interest
    ]
  );

  return rows[0] || null;
}

/**
 * Saves an email supplied by a visitor during a conversation.
 */
export async function captureLeadEmail({
  conversationId,
  email,
  reason = 'provided_in_chat',
  contactName = null,
  companyName = null
}) {
  const normalizedEmail =
    String(email).trim().toLowerCase();

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: conversationRows } =
      await client.query(
        `
          SELECT
            conversation_id,
            visitor_id,
            lead_id,
            primary_language
          FROM conversations
          WHERE conversation_id = $1
          FOR UPDATE
        `,
        [conversationId]
      );

    const conversation =
      conversationRows[0];

    if (!conversation) {
      const error =
        new Error('Conversation not found');

      error.status = 404;

      throw error;
    }

    const domain =
      normalizedEmail.split('@')[1];

    let lead;

    /*
     * If the conversation already has a lead,
     * update that existing lead.
     */
    if (conversation.lead_id) {
      const { rows } =
        await client.query(
          `
            UPDATE leads
            SET
              email = $1,

              email_domain = $2,

              is_business_email = $3,

              email_captured_at =
                COALESCE(
                  email_captured_at,
                  NOW()
                ),

              email_capture_reason = $4,

              contact_name =
                COALESCE(
                  $5,
                  contact_name
                ),

              company_name =
                COALESCE(
                  $6,
                  company_name
                ),

              language =
                COALESCE(
                  language,
                  $7::language_code
                ),

              lead_status =
                CASE
                  WHEN lead_status IN (
                    'known_lead',
                    'inactive'
                  )
                    THEN 'engaged_lead'
                  ELSE lead_status
                END,

              last_interaction_at = NOW()

            WHERE lead_id = $8

            RETURNING *
          `,
          [
            normalizedEmail,
            domain,
            isBusinessEmail(
              normalizedEmail
            ),
            reason,
            contactName,
            companyName,
            conversation.primary_language,
            conversation.lead_id
          ]
        );

      lead = rows[0];
    } else {
      /*
       * If the conversation has no lead,
       * create one using the visitor's email.
       */
      const { rows } =
        await client.query(
          `
            INSERT INTO leads (
              visitor_id,
              source_type,
              contact_name,
              email,
              email_domain,
              is_business_email,
              email_captured_at,
              email_capture_reason,
              company_name,
              language,
              lead_status,
              last_interaction_at
            )
            VALUES (
              $1,
              'website',
              $2,
              $3,
              $4,
              $5,
              NOW(),
              $6,
              $7,
              $8::language_code,
              'engaged_lead',
              NOW()
            )

            ON CONFLICT (LOWER(email))
              WHERE email IS NOT NULL

            DO UPDATE SET
              visitor_id =
                COALESCE(
                  leads.visitor_id,
                  EXCLUDED.visitor_id
                ),

              contact_name =
                COALESCE(
                  EXCLUDED.contact_name,
                  leads.contact_name
                ),

              company_name =
                COALESCE(
                  EXCLUDED.company_name,
                  leads.company_name
                ),

              email_domain =
                EXCLUDED.email_domain,

              is_business_email =
                EXCLUDED.is_business_email,

              email_capture_reason =
                EXCLUDED.email_capture_reason,

              email_captured_at =
                COALESCE(
                  leads.email_captured_at,
                  EXCLUDED.email_captured_at
                ),

              language =
                COALESCE(
                  leads.language,
                  EXCLUDED.language
                ),

              lead_status =
                CASE
                  WHEN leads.lead_status IN (
                    'known_lead',
                    'inactive'
                  )
                    THEN 'engaged_lead'
                  ELSE leads.lead_status
                END,

              last_interaction_at = NOW()

            RETURNING *
          `,
          [
            conversation.visitor_id,
            contactName,
            normalizedEmail,
            domain,
            isBusinessEmail(
              normalizedEmail
            ),
            reason,
            companyName,
            conversation.primary_language
          ]
        );

      lead = rows[0];

      /*
       * Connect the newly created lead
       * to the current conversation.
       */
      await client.query(
        `
          UPDATE conversations
          SET lead_id = $1
          WHERE conversation_id = $2
        `,
        [
          lead.lead_id,
          conversationId
        ]
      );
    }

    await client.query('COMMIT');

    return lead;
  } catch (error) {
    await client.query('ROLLBACK');

    throw error;
  } finally {
    client.release();
  }
}

export async function rememberVisitorName({
  conversationId,
  contactName
}) {
  const safeName =
    String(contactName || '')
      .trim()
      .replace(/\s+/g, ' ');

  if (!safeName) {
    return null;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: conversationRows } =
      await client.query(
        `
          SELECT
            conversation_id,
            visitor_id,
            lead_id,
            primary_language
          FROM conversations
          WHERE conversation_id = $1
          FOR UPDATE
        `,
        [conversationId]
      );

    const conversation =
      conversationRows[0];

    if (!conversation) {
      const error =
        new Error('Conversation not found');

      error.status = 404;

      throw error;
    }

    const { rows } =
      await client.query(
        `
          INSERT INTO leads (
            visitor_id,
            source_type,
            contact_name,
            language,
            lead_status,
            last_interaction_at
          )
          VALUES (
            $1,
            'website',
            $2,
            $3::language_code,
            'known_lead',
            NOW()
          )

          ON CONFLICT (visitor_id)

          DO UPDATE SET
            contact_name =
              COALESCE(
                EXCLUDED.contact_name,
                leads.contact_name
              ),

            language =
              COALESCE(
                leads.language,
                EXCLUDED.language
              ),

            last_interaction_at = NOW()

          RETURNING *
        `,
        [
          conversation.visitor_id,
          safeName,
          conversation.primary_language
        ]
      );

    const lead =
      rows[0];

    if (
      lead &&
      !conversation.lead_id
    ) {
      await client.query(
        `
          UPDATE conversations
          SET lead_id = $1
          WHERE conversation_id = $2
        `,
        [
          lead.lead_id,
          conversationId
        ]
      );
    }

    await client.query('COMMIT');

    return lead;
  } catch (error) {
    await client.query('ROLLBACK');

    throw error;
  } finally {
    client.release();
  }
}

/**
 * Generates the trial link after the visitor
 * provides an email address.
 *
 * The original illegal return statement has
 * been moved inside this function.
 */
export async function handleAwaitingTrialEmail({
  currentStage,
  email,
  conversationId,
  messageLanguage,
  generateTrialRegistrationLink,
  updateConversationStage
}) {
  /*
   * Do nothing if the conversation is not
   * currently waiting for a trial email.
   */
  if (
    currentStage !== 'awaiting_trial_email' ||
    !email
  ) {
    return null;
  }

  if (
    typeof generateTrialRegistrationLink !==
    'function'
  ) {
    throw new TypeError(
      'generateTrialRegistrationLink must be a function'
    );
  }

  if (
    typeof updateConversationStage !==
    'function'
  ) {
    throw new TypeError(
      'updateConversationStage must be a function'
    );
  }

  const trial =
    await generateTrialRegistrationLink(
      conversationId
    );

  await updateConversationStage(
    conversationId,
    'trial_link_generated'
  );

  return {
    answer:
      'Thank you. Your free-trial registration link is ready.',

    language:
      messageLanguage,

    promptMode:
      'registration',

    citations: [],

    action: {
      type:
        'trial_registration',

      label:
        'Start free trial',

      url:
        trial.trialLink,

      trialRegistrationId:
        trial.trialRegistrationId,

      trialStatus:
        trial.trialStatus
    }
  };
}

/**
 * Returns all available personalization data
 * for the current conversation.
 */
export async function getPersonalization(
  conversationId
) {
  const { rows } = await db.query(
    `
      SELECT
        c.*,
        c.primary_language AS language,
        c.conversation_id,
        c.visitor_id,
        c.lead_id,

        v.is_returning_visitor,
        v.first_seen_at,
        v.last_seen_at,

        l.contact_name,
        l.email,
        l.email_domain,
        l.is_business_email,
        l.company_name,
        l.country,
        l.language AS lead_language,
        l.main_interest,
        l.company_need,
        l.pain_points,
        l.main_objection,
        l.preferred_offer,
        l.lead_status,
        l.lead_score,

        l.conversation_summary
          AS lead_conversation_summary,

        l.next_best_action
          AS lead_next_best_action,

        l.free_trial_status,

        sc.contact_person_name,
        sc.contact_person_email,
        sc.area_of_interest,

        co.company_name
          AS sdr_company_name,

        co.company_focus,
        co.company_website,
        co.company_location,

        competitor.company_name
          AS competitor_name,

        previous.previous_conversation_summary,
        previous.previous_next_best_action,
        previous.previous_interests,
        previous.previous_needs,
        previous.previous_objections

      FROM conversations c

      INNER JOIN visitors v
        ON v.visitor_id = c.visitor_id

      LEFT JOIN LATERAL (
        SELECT possible_lead.*
        FROM leads possible_lead
        WHERE possible_lead.lead_id = c.lead_id
          OR (
            c.lead_id IS NULL
            AND possible_lead.visitor_id = c.visitor_id
          )
        ORDER BY
          CASE
            WHEN possible_lead.lead_id = c.lead_id
              THEN 0
            ELSE 1
          END,
          possible_lead.last_interaction_at DESC NULLS LAST,
          possible_lead.created_at DESC
        LIMIT 1
      ) l ON TRUE

      LEFT JOIN sdr_contacts sc
        ON sc.sdr_contact_id =
           l.sdr_contact_id

      LEFT JOIN sdr_companies co
        ON co.sdr_company_id =
           COALESCE(
             l.sdr_company_id,
             sc.sdr_company_id
           )

      LEFT JOIN sdr_companies competitor
        ON competitor.sdr_company_id =
           co.competitor_company_id

      LEFT JOIN LATERAL (
        SELECT
          old_conversation.conversation_summary
            AS previous_conversation_summary,

          old_conversation.next_best_action
            AS previous_next_best_action,

          old_conversation.interests_discovered
            AS previous_interests,

          old_conversation.needs_discovered
            AS previous_needs,

          old_conversation.objections_discovered
            AS previous_objections

        FROM conversations old_conversation

        WHERE old_conversation.visitor_id =
              c.visitor_id

          AND old_conversation.conversation_id <>
              c.conversation_id

        ORDER BY
          old_conversation.started_at DESC

        LIMIT 1
      ) previous ON TRUE

      WHERE c.conversation_id = $1

      LIMIT 1
    `,
    [conversationId]
  );

  return rows[0] || null;
}

/**
 * Updates a lead using information extracted
 * from the conversation analysis.
 */
export async function updateLeadFromConversationAnalysis({
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
      UPDATE leads l

      SET
        conversation_summary =
          COALESCE(
            $2,
            l.conversation_summary
          ),

        main_interest =
          COALESCE(
            NULLIF($3, ''),
            l.main_interest
          ),

        company_need =
          COALESCE(
            NULLIF($4, ''),
            l.company_need
          ),

        pain_points =
          COALESCE(
            NULLIF($5, ''),
            l.pain_points
          ),

        main_objection =
          COALESCE(
            NULLIF($6, ''),
            l.main_objection
          ),

        next_best_action =
          COALESCE(
            $7,
            l.next_best_action
          ),

        lead_status =
          CASE
            WHEN $8 IN (
              'trial_requested',
              'registration_started'
            )
              THEN
                'trial_requested'::lead_status_type

            WHEN $8 =
                 'registration_completed'
              THEN
                'trial_started'::lead_status_type

            WHEN $8 IN (
              'product_interest',
              'pricing_interest',
              'trial_interest',
              'demo_requested',
              'human_follow_up_requested'
            )
              AND l.lead_status IN (
                'known_lead',
                'engaged_lead'
              )
              THEN
                'qualified_lead'::lead_status_type

            WHEN l.lead_status =
                 'known_lead'
              THEN
                'engaged_lead'::lead_status_type

            ELSE l.lead_status
          END,

        free_trial_status =
          CASE
            WHEN $8 = 'trial_requested'
              THEN
                'requested'::trial_status_type

            WHEN $8 =
                 'registration_started'
              THEN
                'in_progress'::trial_status_type

            WHEN $8 =
                 'registration_completed'
              THEN
                'submitted'::trial_status_type

            ELSE l.free_trial_status
          END,

        last_interaction_at = NOW()

      FROM conversations c

      WHERE c.conversation_id = $1
        AND c.lead_id = l.lead_id

      RETURNING l.*
    `,
    [
      conversationId,
      summary || null,
      interests[0] || null,
      needs[0] || null,
      needs.join('; ') || null,
      objections[0] || null,
      nextBestAction,
      outcome
    ]
  );

  return rows[0] || null;
}
