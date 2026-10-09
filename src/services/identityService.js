import {
  v4 as uuidv4
} from 'uuid';

import {
  tx
} from '../config/database.js';

import {
  hashSdrToken
} from '../utils/crypto.js';

import {
  findActiveSdrContactByTokenHash,
  markSdrLinkOpened
} from '../repositories/sdrRepository.js';

import {
  upsertVisitor
} from '../repositories/visitorRepository.js';

import {
  upsertSdrLead
} from '../repositories/leadRepository.js';



import {
  createConversation,
  findReusableOpenConversation
} from '../repositories/conversationRepository.js';

const supportedLanguages = [
  'en',
  'de',
  'it',
  'es',
  'fr'
];


/*
 * =========================================================
 * NORMALIZE LANGUAGE
 * =========================================================
 */
function normalizeLanguage(
  language,
  fallback = 'en'
) {
  const normalized =
    String(language || '')
      .trim()
      .toLowerCase()
      .split('-')[0];


  return supportedLanguages.includes(
    normalized
  )
    ? normalized
    : fallback;
}


/*
 * =========================================================
 * FIND SDR IDENTITY
 * =========================================================
 *
 * Receives the RAW token from:
 *
 * ?sdr_token=...
 *
 * or:
 *
 * ?t=...
 *
 * Then:
 *
 * raw token
 *   ↓
 * hash token
 *   ↓
 * search sdr_contacts
 *   ↓
 * return SDR contact if found
 */
export async function findSdrIdentity(
  rawToken
) {
  /*
   * Normal visitor with no SDR token.
   */
  if (!rawToken) {
    return null;
  }


  /*
   * Hash the incoming token.
   *
   * The raw token itself should not be stored
   * or compared directly in PostgreSQL.
   */
  const tokenHash =
    hashSdrToken(
      rawToken
    );


  /*
   * Find an active SDR contact using the hash.
   */
  const sdr =
    await findActiveSdrContactByTokenHash(
      tokenHash
    );


  /*
   * If this was a valid SDR personalized link,
   * record that the contact opened it.
   */
  if (sdr) {
    await markSdrLinkOpened(
      sdr.sdr_contact_id
    );
  }


  return sdr;
}


/*
 * =========================================================
 * START VISITOR SESSION
 * =========================================================
 *
 * Handles BOTH:
 *
 * 1. SDR visitor
 * 2. Normal website visitor
 */
export async function startSession({
  cookieId,
  metadata,
  sdr,
  language = 'en'
}) {
  /*
   * Use one DB transaction so visitor, lead and
   * conversation creation stay consistent.
   */
  return tx(
    async (
      client
    ) => {

      /*
       * -------------------------------------------------
       * VISITOR COOKIE
       * -------------------------------------------------
       *
       * Returning visitor:
       * use existing cookie.
       *
       * New visitor:
       * generate new UUID.
       */
      const visitorCookie =
        cookieId ||
        uuidv4();


      /*
       * -------------------------------------------------
       * CREATE / UPDATE VISITOR
       * -------------------------------------------------
       */
      const visitor =
        await upsertVisitor(
          client,
          {
            cookieId:
              visitorCookie,

            metadata,

            isSdrIdentified:
              Boolean(sdr)
          }
        );


      /*
       * -------------------------------------------------
       * CREATE / UPDATE SDR LEAD
       * -------------------------------------------------
       *
       * SDR visitor:
       * immediately create/link lead.
       *
       * Normal visitor:
       * lead remains NULL until we capture email later.
       */
      const lead =
        sdr
          ? await upsertSdrLead(
              client,
              visitor.visitor_id,
              sdr
            )
          : null;


      /*
       * -------------------------------------------------
       * INITIAL LANGUAGE
       * -------------------------------------------------
       *
       * Priority:
       *
       * 1. SDR preferred language
       * 2. browser/frontend language
       * 3. metadata language
       * 4. English
       */
      const initialLanguage =
        normalizeLanguage(
          sdr?.preferred_language ||
          language ||
          metadata?.language ||
          'en'
        );


      /*
       * -------------------------------------------------
       * CREATE CONVERSATION
       * -------------------------------------------------
       */
      const existingConversation =
         await findReusableOpenConversation(
           client,
           {
      visitorId:
        visitor.visitor_id
    }
  );

      const conversation =
  existingConversation ||
  await createConversation(
    client,
    {
      visitorId:
        visitor.visitor_id,

      leadId:
        lead?.lead_id ||
        null,

      language:
        initialLanguage,

      metadata
    }
  );


      /*
       * Return everything sessionController needs.
       */
      return {
        visitorCookie,
        visitor,
        lead,
        conversation
      };
    }
  );
}