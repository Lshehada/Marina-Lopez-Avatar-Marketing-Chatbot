export async function upsertVisitor(
  client,
  {
    cookieId,
    metadata,
    isSdrIdentified
  }
) {
  const { rows } =
    await client.query(
      `
        INSERT INTO visitors (
          cookie_id,
          first_source,
          latest_source,
          referrer,
          landing_page,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          country,
          language,
          browser,
          device_type,
          is_sdr_identified
        )
        VALUES (
          $1,
          $2,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14
        )

        ON CONFLICT (cookie_id)
        DO UPDATE SET
          last_seen_at = now(),

          latest_source =
            COALESCE(
              EXCLUDED.latest_source,
              visitors.latest_source
            ),

          referrer =
            COALESCE(
              EXCLUDED.referrer,
              visitors.referrer
            ),

          landing_page =
            COALESCE(
              EXCLUDED.landing_page,
              visitors.landing_page
            ),

          utm_source =
            COALESCE(
              EXCLUDED.utm_source,
              visitors.utm_source
            ),

          utm_medium =
            COALESCE(
              EXCLUDED.utm_medium,
              visitors.utm_medium
            ),

          utm_campaign =
            COALESCE(
              EXCLUDED.utm_campaign,
              visitors.utm_campaign
            ),

          utm_content =
            COALESCE(
              EXCLUDED.utm_content,
              visitors.utm_content
            ),

          utm_term =
            COALESCE(
              EXCLUDED.utm_term,
              visitors.utm_term
            ),

          country =
            COALESCE(
              EXCLUDED.country,
              visitors.country
            ),

          language =
            COALESCE(
              EXCLUDED.language,
              visitors.language
            ),

          browser =
            COALESCE(
              EXCLUDED.browser,
              visitors.browser
            ),

          device_type =
            COALESCE(
              EXCLUDED.device_type,
              visitors.device_type
            ),

          is_returning_visitor = true,

          is_sdr_identified =
            visitors.is_sdr_identified
            OR EXCLUDED.is_sdr_identified

        RETURNING *
      `,
      [
        cookieId,
        metadata.source,
        metadata.referrer,
        metadata.landingPage,
        metadata.utmSource,
        metadata.utmMedium,
        metadata.utmCampaign,
        metadata.utmContent,
        metadata.utmTerm,
        metadata.country,
        metadata.language,
        metadata.browser,
        metadata.deviceType,
        isSdrIdentified
      ]
    );

  return rows[0];
}