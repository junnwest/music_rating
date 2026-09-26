import apn from 'apn';

const _providers = new Map<boolean, apn.Provider | null>();

/**
 * Lazily builds the shared APNs provider for one environment (sandbox or
 * production). Returns null (and callers should no-op) until APNS_KEY_ID /
 * APNS_TEAM_ID / APNS_PRIVATE_KEY are configured.
 */
function getProvider(production: boolean): apn.Provider | null {
  if (_providers.has(production)) return _providers.get(production)!;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawKey = process.env.APNS_PRIVATE_KEY;

  if (!keyId || !teamId || !rawKey) {
    _providers.set(production, null);
    return null;
  }

  const provider = new apn.Provider({
    token: {
      key: rawKey.replace(/\\n/g, '\n'),
      keyId,
      teamId,
    },
    production,
  });
  _providers.set(production, provider);
  return provider;
}

/**
 * Sends one alert push. Device tokens are environment-specific: an Xcode
 * debug build registers a sandbox token, a TestFlight/App Store build a
 * production token, and both end up in the same profiles.push_token column.
 * So we try the APNS_PRODUCTION environment first and, if Apple says the
 * token belongs to the other one (BadDeviceToken), retry there.
 */
export async function sendPushNotification(deviceToken: string, title: string, body: string): Promise<void> {
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!bundleId) return; // not configured — silent no-op

  const primary = process.env.APNS_PRODUCTION === 'true';
  for (const production of [primary, !primary]) {
    const provider = getProvider(production);
    if (!provider) return; // not configured — silent no-op

    const note = new apn.Notification();
    note.topic = bundleId;
    note.alert = { title, body };
    note.sound = 'default';
    note.badge = 1;

    const result = await provider.send(note, deviceToken);
    if (result.sent.length > 0) return;

    const failure = result.failed[0];
    const reason = failure?.response?.reason ?? failure?.error?.message ?? 'unknown';
    if (reason === 'BadDeviceToken' && production === primary) continue; // wrong environment — try the other
    console.error(`[apns] push failed (${production ? 'production' : 'sandbox'}): ${failure?.status ?? ''} ${reason}`);
    return;
  }
}
