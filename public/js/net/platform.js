// Where the app is running. Inside the iPhone and Android apps (Capacitor) the pages come from the
// app itself (capacitor://localhost or https://localhost), so server calls, online play and shared
// links use the public site instead of the page's own origin.
export const SITE = globalThis.OC_SITE ?? 'https://chess.solankidigitaldrafts.com';

export const isNativeApp = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

// The origin for links other people open (challenge links, room invitations).
export const siteOrigin = () => (isNativeApp() ? SITE : location.origin);
