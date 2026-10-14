// Files that let links to the site open the iPhone and Android apps. Android trusts an app whose
// signing certificate's SHA-256 fingerprint is listed here; iOS needs the Apple Developer team id.
// Fingerprints are public (anyone can read this file from the site), so the known ones live here;
// more can be added on the live server without a release:
//   ANDROID_CERT_SHA256=AB:CD:…[,…]   APPLE_TEAM_ID=ABCDE12345
export const APP_ID = 'com.solankidigitaldrafts.chess'; // as in capacitor.config.json

// Both certificates that sign the app: Google Play's app-signing key (Play Console → Test and
// release → App integrity → App signing), for installs from the Play Store, and our upload key
// (~/.jodhpur-studio/secrets/onlinechess-upload.jks), for the .apk installed directly.
export const ANDROID_CERTS = [
  '1E:0D:68:48:BC:F2:55:78:FC:C0:3E:88:85:49:7C:64:46:86:D7:BA:CC:23:4B:26:3A:3A:31:CA:FA:CE:25:28', // Play app signing
  '26:8F:9E:37:37:07:68:E9:86:10:CD:37:00:51:94:F6:5A:C6:48:65:8E:0C:0C:34:09:56:58:1F:D5:1C:90:58', // upload key
];

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// -> { '/.well-known/…': json string } for whatever is configured.
export function appLinkFiles(env = process.env) {
  const files = {};
  const extra = (env.ANDROID_CERT_SHA256 ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  const certs = [...new Set([...ANDROID_CERTS, ...extra])];
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
