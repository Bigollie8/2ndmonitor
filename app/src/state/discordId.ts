// ─────────────────────────────────────────────────────────────────────────────
// Validating the Discord Application ID before we send anyone to Discord.
//
// Pasting the wrong value is the single most common setup failure: the
// Developer Portal shows the Application ID and the Public Key on the SAME
// page, and the OAuth2 page labels the same number "CLIENT ID" — so people
// reasonably paste the public key, a bot token, or the whole OAuth2 URL.
// Discord then answers with a bare "unknown application" page, which gives no
// hint about which field was wrong.
//
// A Discord ID is a snowflake: decimal digits only, currently 17-20 of them.
// Checking that here means the mistake is caught in the tile, next to the
// instructions, instead of on a Discord error page.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientIdCheck {
  ok: boolean;
  /** Present when `ok` is false — says what was pasted and what to get instead. */
  problem?: string;
}

/** Snowflakes are 17-20 digits today. The range is deliberately loose at both
 *  ends so a future widening doesn't reject a legitimate id. */
const SNOWFLAKE = /^\d{17,20}$/;

export function checkDiscordClientId(raw: string): ClientIdCheck {
  const v = raw.trim();

  if (v === '') {
    return { ok: false, problem: 'Paste your Application ID above.' };
  }
  if (SNOWFLAKE.test(v)) {
    return { ok: true };
  }
  if (/^https?:\/\//i.test(v)) {
    return {
      ok: false,
      problem: 'That looks like a URL. Paste just the Application ID — the long number on the app’s General Information page.',
    };
  }
  if (/^[0-9a-f]{64}$/i.test(v)) {
    return {
      ok: false,
      problem: 'That’s the Public Key, not the Application ID. The Application ID is the long number above it on the same page.',
    };
  }
  if (v.includes('.') && v.length > 40) {
    return {
      ok: false,
      problem: 'That looks like a bot token. Never paste a token here — this needs the Application ID, the long number on the General Information page.',
    };
  }
  if (/^\d+$/.test(v)) {
    return {
      ok: false,
      problem: `An Application ID is 17–20 digits; this one is ${v.length}. Check you copied the whole number.`,
    };
  }
  return {
    ok: false,
    problem: 'An Application ID is digits only (17–20 of them). Copy it from the app’s General Information page.',
  };
}
