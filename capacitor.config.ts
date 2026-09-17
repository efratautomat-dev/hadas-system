import type { CapacitorConfig } from '@capacitor/cli'

// InControl — Android shell.
//
// The APK is deliberately almost empty. It ships ONE local page (`shell/`), whose
// whole job is to turn a short store code into an address and hand the WebView over
// to the customer's live site. Everything the business actually uses — every screen,
// every fix — arrives through the normal `npm run deploy`, not through an APK the
// owner has to reinstall on every tablet.
//
// Two consequences worth stating out loud:
//   • `webDir` is `dist-shell`, NOT `dist`. The app never bundles the system itself.
//   • `allowNavigation` lists the hosts the GENERIC build may hand the WebView to
//     after the store gate. It is NOT a wildcard, and must never become one: every
//     entry is registered as an authority on Capacitor's local asset server
//     (WebViewLocalServer.java:704), so those hosts get served out of the APK
//     instead of fetched. `'*'` meant "intercept the entire internet", and a real
//     tablet showed the offline page on a perfectly good connection because of it.
//     A branded build sets no allow-list at all — its server.url is allowed by
//     definition. Adding a customer to the registry means adding their host here
//     and rebuilding the generic APK; branded builds are unaffected.
// A branded build passes its customer's identity in the environment, because
// `npx cap sync` REWRITES res/values/strings.xml from this file — setting those
// strings by hand after a sync is a race that sync wins. scripts/release-apk.mjs
// sets these; an ordinary build has them unset and is the generic app.
const config: CapacitorConfig = {
  appId: process.env.INCONTROL_APP_ID ?? 'com.ctrlplusf.incontrol',
  appName: process.env.INCONTROL_APP_NAME ?? 'InControl',
  webDir: 'dist-shell',
  android: {
    // The tablets are shared devices in a shop; a WebView that keeps its own
    // zoom state between users is a support call waiting to happen.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // Shown when the customer's site cannot be reached. It is a LOCAL page with no
    // access to Capacitor plugins (Capacitor's own constraint) — so it must not try
    // to read the stored store code; reloading is all it can offer.
    errorPath: 'offline.html',
    allowNavigation: ['incontrol.ctrlplusf.com', 'hadas-system.vercel.app'],
  },
}

export default config
