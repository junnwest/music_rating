import apn from 'apn';

let _provider: apn.Provider | null | undefined;

/**
 * Lazily builds the shared APNs provider. Returns null (and callers should
 * no-op) until APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY are configured.
 */
function getProvider(): apn.Provider | null {
  if (_provider !== undefined) return _provider;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawKey = process.env.APNS_PRIVATE_KEY;

  if (!keyId || !teamId || !rawKey) {
    _provider = null;
    return null;
  }

  _provider = new apn.Provider({
    token: {
      key: rawKey.replace(/\\n/g, '\n'),
      keyId,
      teamId,
    },
    production: process.env.APNS_PRODUCTION === 'true',
  });

  return _provider;
}

export async function sendPushNotification(deviceToken: string, title: string, body: string): Promise<void> {
  const provider = getProvider();
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!provider || !bundleId) return; // not configured — silent no-op

  const note = new apn.Notification();
  note.topic = bundleId;
  note.alert = { title, body };
  note.sound = 'default';
  note.badge = 1;

  await provider.send(note, deviceToken);
}
