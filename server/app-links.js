// Files that let links to the site open the iPhone and Android apps. Their contents come from the
// store accounts (Android: the SHA-256 fingerprints of the app-signing certificates in Play
// Console; iOS: the Apple Developer team id), set as environment variables on the live server:
//   ANDROID_CERT_SHA256=AB:CD:…[,…]   APPLE_TEAM_ID=ABCDE12345
export const APP_ID = 'com.solankidigitaldrafts.chess'; // as in capacitor.config.json

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// -> { '/.well-known/…': json string } for whatever is configured.
export function appLinkFiles(env = process.env) {
  const files = {};
  const certs = (env.ANDROID_CERT_SHA256 ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (certs.length && !certs.every((c) => FINGERPRINT.test(c))) console.warn('ANDROID_CERT_SHA256 is not a list of SHA-256 fingerprints; Android app links are off.');
  if (env.APPLE_TEAM_ID && !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) console.warn('APPLE_TEAM_ID is not a 10-character team id; iOS universal links are off.');
  if (certs.length && certs.every((c) => FINGERPRINT.test(c))) {
    files['/.well-known/assetlinks.json'] = JSON.stringify([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: certs },
    }]);
  }
  if (/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? '')) {
    files['/.well-known/apple-app-site-association'] = JSON.stringify({
      applinks: { details: [{ appIDs: [`${env.APPLE_TEAM_ID}.${APP_ID}`], components: [{ '/': '/', comment: 'the app and its #/ screens' }] }] },
    });
  }
  return files;
}
