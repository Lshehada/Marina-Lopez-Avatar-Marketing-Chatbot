function normalizeCountry(value) {
  const country =
    String(value || '')
      .trim()
      .toUpperCase();

  return /^[A-Z]{2}$/.test(country)
    ? country
    : null;
}

function getClientIp(req) {
  const forwarded =
    req.headers['x-forwarded-for'];

  const forwardedIp =
    Array.isArray(forwarded)
      ? forwarded[0]
      : String(forwarded || '')
          .split(',')[0]
          .trim();

  const ip =
    forwardedIp ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;

  return String(ip || '')
    .replace('::ffff:', '')
    .trim() || null;
}

function isPublicIp(ip) {
  if (!ip) {
    return false;
  }

  return !(
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.')
  );
}

async function findCountryFromIp(ip) {
  if (!isPublicIp(ip)) {
    return null;
  }

  try {
    const response = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}`,
      {
        signal:
          AbortSignal.timeout(1500)
      }
    );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    return normalizeCountry(
      data.country_code
    );

  } catch {
    /*
     * Country lookup must never stop session creation.
     */
    return null;
  }
}

export async function getVisitorMetadata(
  req,
  body = {}
) {
  const headerCountry =
    normalizeCountry(
      req.get('cf-ipcountry') ||
      req.get('x-vercel-ip-country') ||
      req.get('x-country-code')
    );

  const clientIp =
    getClientIp(req);

  const country =
    headerCountry ||
    await findCountryFromIp(clientIp);

  return {
    source:
      body.source || 'website',

    referrer:
      body.referrer ||
      req.get('referer') ||
      null,

    landingPage:
      body.landingPage ||
      null,

    utmSource:
      body.utmSource ||
      null,

    utmMedium:
      body.utmMedium ||
      null,

    utmCampaign:
      body.utmCampaign ||
      null,

    utmContent:
      body.utmContent ||
      null,

    utmTerm:
      body.utmTerm ||
      null,

    language:
      body.language ||
      null,

    country,

    browser:
      req.get('user-agent') ||
      null,

    deviceType:
      'web'
  };
}