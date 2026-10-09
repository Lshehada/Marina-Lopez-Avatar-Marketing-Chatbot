import { db } from '../config/database.js';

export async function findActiveSdrContactByTokenHash(tokenHash) {
  const { rows } = await db.query(`
    SELECT c.sdr_contact_id, c.sdr_company_id, c.contact_person_name,
           c.contact_person_email, c.preferred_language, c.area_of_interest,
           co.company_name, co.company_website, co.company_focus, co.company_location
      FROM sdr_contacts c
      JOIN sdr_companies co USING (sdr_company_id)
     WHERE c.unique_link_token_hash=$1 AND c.token_status='active'
     LIMIT 1`, [tokenHash]);
  return rows[0] || null;
}

export async function markSdrLinkOpened(sdrContactId) {
  await db.query(`UPDATE sdr_contacts
    SET unique_link_first_opened_at=COALESCE(unique_link_first_opened_at,now()),
        unique_link_last_opened_at=now()
    WHERE sdr_contact_id=$1`, [sdrContactId]);
}
