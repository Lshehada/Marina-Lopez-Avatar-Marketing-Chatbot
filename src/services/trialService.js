import { randomUUID } from 'node:crypto';

import {
  db
} from '../config/database.js';

import {
  config
} from '../config/index.js';


function normalizeText(text = '') {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[.!?¿¡,;:]/g, '')
    .replace(/\s+/g, ' ');
}


/*
 * Scenario A:
 *
 * User explicitly asks to START a trial.
 *
 * This should NOT match someone merely asking:
 * "What is the free trial?"
 */
export function isExplicitTrialStartRequest(
  text
) {
  const message =
    normalizeText(text);

  const patterns = [
    /*
     * English
     */
    /\b(i want|i would like|i'd like|yes i want|yes i'd like|let me|i want to)\b.*\b(start|begin|register|sign up|try)\b.*\b(trial|free trial)\b/i,
    /\b(start|begin|register for|sign me up for)\b.*\b(trial|free trial)\b/i,

    /*
     * German
     */
    /\b(ich möchte|ich will|ja ich möchte)\b.*\b(testversion|kostenlos testen|registrieren|starten)\b/i,

    /*
     * Italian
     */
    /\b(voglio|vorrei|sì voglio|si voglio)\b.*\b(prova gratuita|registrarmi|iniziare)\b/i,

    /*
     * Spanish
     */
    /\b(quiero|me gustaría|sí quiero|si quiero)\b.*\b(prueba gratis|prueba gratuita|registrarme|empezar)\b/i,

    /*
     * French
     */
    /\b(je veux|je voudrais|oui je veux)\b.*\b(essai gratuit|m'inscrire|commencer)\b/i
  ];

  return patterns.some(
    (pattern) =>
      pattern.test(message)
  );
}


/*
 * Scenario B:
 *
 * This is only meaningful when the conversation is
 * currently in stage "trial_offered".
 */
export function isAffirmativeReply(
  text
) {
  const message =
    normalizeText(text);

  const affirmativeReplies =
    new Set([
      // English
      'yes',
      'yes please',
      'sure',
      'okay',
      'ok',
      'yes i do',
      'yes i would',
      'yes id like to',

      // German
      'ja',
      'ja bitte',
      'gerne',

      // Italian
      'si',
      'sì',
      'sì grazie',
      'si grazie',
      'certo',

      // Spanish
      'sí',
      'si',
      'sí por favor',
      'si por favor',
      'claro',

      // French
      'oui',
      'oui merci',
      'oui sil vous plaît',
      "oui s'il vous plaît"
    ]);

  return affirmativeReplies.has(
    message
  );
}


/*
 * Detect whether Marina's generated response actually
 * offered to START a trial.
 *
 * We will use this to set:
 *
 * conversation_stage = 'trial_offered'
 */
export function isTrialOfferQuestion(
  text
) {
  const message =
    String(text || '').toLowerCase();

  const mentionsTrial =
    /free trial|testversion|kostenlos.*testen|prova gratuita|prueba (gratis|gratuita)|essai gratuit/i
      .test(message);

  const asksToStart =
    /would you like|do you want|ready to start|möchten sie|willst du|vuoi|vorresti|quieres|te gustaría|souhaitez-vous|voulez-vous|\?/i
      .test(message);

  return (
    mentionsTrial &&
    asksToStart
  );
}


/*
 * ONLY THIS FUNCTION creates a trial_registrations row.
 *
 * Therefore:
 *
 * No link = no row.
 */
export async function generateTrialLink(
  conversationId
) {
  const client =
    await db.connect();

  try {
    await client.query('BEGIN');

    const { rows } =
      await client.query(
        `
          SELECT
            c.conversation_id,
            c.lead_id,
            l.sdr_contact_id,
            l.free_trial_status

          FROM conversations c

          LEFT JOIN leads l
            ON l.lead_id =
               c.lead_id

          WHERE c.conversation_id = $1

          FOR UPDATE OF c
        `,
        [
          conversationId
        ]
      );

    const conversation =
      rows[0];

    if (!conversation) {
      const error =
        new Error(
          'Conversation not found'
        );

      error.status = 404;

      throw error;
    }

    /*
     * We cannot create trial_registration because
     * lead_id is mandatory.
     */
    if (!conversation.lead_id) {
      const error =
        new Error(
          'Lead required before generating trial link'
        );

      error.code =
        'LEAD_REQUIRED';

      throw error;
    }

    /*
     * Look for an existing unfinished request.
     *
     * If Marina already generated a link for this lead,
     * reuse it instead of creating another DB row.
     */
    const existingResult =
      await client.query(
        `
          SELECT *
          FROM trial_registrations

          WHERE lead_id = $1
            AND trial_status IN (
              'requested',
              'in_progress'
            )

          ORDER BY
            trial_first_requested_at DESC

          LIMIT 1

          FOR UPDATE
        `,
        [
          conversation.lead_id
        ]
      );

    const existing =
      existingResult.rows[0];

    if (existing) {
      const updatedResult =
        await client.query(
          `
            UPDATE trial_registrations
            SET
              conversation_id = $2,
              trial_last_requested_at = now()

            WHERE trial_registration_id = $1

            RETURNING *
          `,
          [
            existing.trial_registration_id,
            conversationId
          ]
        );

      await client.query(
        `
          UPDATE leads
          SET
            free_trial_status = 'requested',
            lead_status =
              CASE
                WHEN lead_status IN (
                  'known_lead',
                  'engaged_lead',
                  'qualified_lead'
                )
                THEN 'trial_requested'
                ELSE lead_status
              END,
            last_interaction_at = now()
          WHERE lead_id = $1
        `,
        [
          conversation.lead_id
        ]
      );

      await client.query('COMMIT');

      return updatedResult.rows[0];
    }

    /*
     * Generate the ID FIRST.
     *
     * Then build the real URL.
     *
     * Only after the URL exists do we INSERT the row.
     */
    const trialRegistrationId =
      randomUUID();

    const url =
      new URL(
        config.TRIAL_REGISTRATION_URL
      );

    url.searchParams.set(
      'trial_registration_id',
      trialRegistrationId
    );

    const trialLink =
      url.toString();

    /*
     * This is the ONLY INSERT into trial_registrations.
     */
    const trialResult =
      await client.query(
        `
          INSERT INTO trial_registrations (
            trial_registration_id,
            lead_id,
            conversation_id,
            sdr_contact_id,
            trial_first_requested_at,
            trial_last_requested_at,
            trial_status,
            trial_status_submission_at,
            trial_link
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            now(),
            now(),
            'requested',
            NULL,
            $5
          )

          RETURNING *
        `,
        [
          trialRegistrationId,
          conversation.lead_id,
          conversationId,
          conversation.sdr_contact_id,
          trialLink
        ]
      );

    await client.query(
      `
        UPDATE leads
        SET
          free_trial_status =
            'requested',

          lead_status =
            CASE
              WHEN lead_status IN (
                'known_lead',
                'engaged_lead',
                'qualified_lead'
              )
              THEN 'trial_requested'
              ELSE lead_status
            END,

          last_interaction_at =
            now()

        WHERE lead_id = $1
      `,
      [
        conversation.lead_id
      ]
    );

    await client.query('COMMIT');

    return trialResult.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
}


/*
 * Called by the WEBSITE only after its actual
 * registration form was successfully submitted.
 */
export async function markTrialSubmitted(
  trialRegistrationId
) {
  const client =
    await db.connect();

  try {
    await client.query('BEGIN');

    const result =
      await client.query(
        `
          UPDATE trial_registrations

          SET
            trial_status =
              'submitted',

            trial_status_submission_at =
              COALESCE(
                trial_status_submission_at,
                now()
              )

          WHERE trial_registration_id = $1

          RETURNING *
        `,
        [
          trialRegistrationId
        ]
      );

    const trial =
      result.rows[0];

    if (!trial) {
      const error =
        new Error(
          'Trial registration not found'
        );

      error.status = 404;

      throw error;
    }

    /*
     * Keep lead status synchronized.
     */
    await client.query(
      `
        UPDATE leads
        SET
          free_trial_status =
            'submitted',

          lead_status =
            'trial_started',

          last_interaction_at =
            now()

        WHERE lead_id = $1
      `,
      [
        trial.lead_id
      ]
    );

    await client.query('COMMIT');

    return trial;

  } catch (error) {
    await client.query('ROLLBACK');

    throw error;

  } finally {
    client.release();
  }
}
