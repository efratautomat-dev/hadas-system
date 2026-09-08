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
//   • `allowNavigation: ['*']` is on purpose. The hand-off to the customer's domain
//     has to stay INSIDE the WebView, and each customer sits on their own server —
//     a host allow-list would mean a new APK for every new domain. Everywhere we
//     genuinely want the system browser (printing, PDFs, downloads) says so
//     explicitly through `openExternal()` in `src/lib/native.ts`, so nothing here
//     depends on Capacitor's default external-URL behaviour.
const config: CapacitorConfig = {
  appId: 'com.ctrlplusf.incontrol',
  appName: 'InControl',
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
    allowNavigation: ['*'],
  },
}

export default config
