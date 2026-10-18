// native — the one place that knows the app is running inside the Android shell.
//
// The SAME bundle serves the browser and the tablet: the APK loads the live site,
// it does not carry a copy of it. So every screen must behave exactly as it does
// today when there is no shell around it, and the platform question must be asked
// in one place rather than in each caller — the same reason `noteSources.ts` exists.
//
// Three things the Android WebView simply does not do, which is what this module
// is for:
//   • `window.print()` is a no-op, and `window.open('', '_blank')` returns null,
//     so the print-window pattern the PDFs use produces nothing at all.
//   • It has no PDF renderer, so a PDF in an <iframe> is a blank rectangle.
//   • It ignores `download` on blob: URLs, so exports silently do nothing.
// Each of those is answered by handing the job to the tablet's real Chrome.
//
// RULE: no static `@capacitor/*` import in this file. Every plugin arrives through
// `await import()` inside an `isNative()` branch, so the browser bundle never loads
// a byte of it and the demo build is unchanged.

declare global {
  interface Window {
    // The bridge Capacitor injects into the page. Typed narrowly on purpose —
    // `as any` would be an eslint error, and this is all we actually touch.
    Capacitor?: {
      isNativePlatform?: () => boolean
      getPlatform?: () => string
    }
  }
}

const STORE_KEYS = ['incontrol.storeCode', 'incontrol.storeUrl']

// An Android intent has a hard size limit, and the print payload rides in a URL.
// 200KB of encoded text is far below it and far above any real document — the
// guard exists so an absurd ledger says so instead of failing silently.
const MAX_PRINT_URL = 200_000

export function isNative(): boolean {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true
}

/**
 * Opens a URL where the viewer can actually use it, and SAYS SO when it cannot.
 *
 * In the browser that is a new tab, exactly as before. On the tablet it is the
 * real Chrome app rather than an in-app browser tab — Chrome has Print and a PDF
 * viewer; an in-app tab has neither, which is the whole point of leaving.
 *
 * But one of the shop's tablets has no browser at all, and there "open the email"
 * did nothing: no app answered the intent, no error, no sign anything had been
 * asked. So when nothing can open the link, it goes to the clipboard instead and
 * the caller is told — a link you can paste into a phone beats a button that
 * quietly does nothing.
 *
 * Returns true when the link was opened, false when it was only copied.
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!url) return false
  if (!isNative()) {
    window.open(url, '_blank', 'noopener')
    return true
  }

  const { AppLauncher } = await import('@capacitor/app-launcher')
  try {
    const { value } = await AppLauncher.canOpenUrl({ url })
    if (value) {
      await AppLauncher.openUrl({ url })
      return true
    }
  } catch {
    // Some devices refuse the query itself; the attempt below is still worth making.
    try {
      await AppLauncher.openUrl({ url })
      return true
    } catch {
      // fall through to the clipboard
    }
  }

  const { copyText } = await import('./clipboard')
  await copyText(url)
  return false
}

/**
 * Downloads a new build and hands it to Android's installer, without a browser.
 *
 * The shop's tablets have none, by policy — so "open the download link" was never
 * a route there, and every update meant carrying the file in by hand. The app
 * fetches its own update instead. Android still shows its own confirmation and
 * asks once for permission to install from this app; nothing installs silently.
 *
 * Returns false if the native path is unavailable, so the caller can fall back to
 * opening the link the old way.
 */
export async function installUpdate(url: string): Promise<boolean> {
  if (!isNative() || !url) return false
  const StoreGate = (window as unknown as {
    Capacitor?: { Plugins?: { StoreGate?: { installUpdate?: (o: { url: string }) => Promise<void> } } }
  }).Capacitor?.Plugins?.StoreGate
  if (!StoreGate?.installUpdate) return false
  try {
    await StoreGate.installUpdate({ url })
    return true
  } catch (err) {
    console.error('[native] in-app update failed:', err)
    return false
  }
}

export type EmailOpen = 'opened' | 'gmail-app' | 'copied-subject' | 'copied-link'

/**
 * Props for an outbound <a>. In the browser it stays a plain new-tab link (so
 * middle-click and "copy link" still work); on the tablet a target="_blank"
 * does nothing at all, silently, so the click is handed to openExternal().
 */
export function externalLinkProps(url: string) {
  return {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: (e: { preventDefault(): void }) => {
      if (isNative()) {
        e.preventDefault()
        // A Gmail web link goes to the Gmail app, never to the browser.
        void (url.includes('mail.google.com') ? openEmail(url) : openExternal(url))
      }
    },
  }
}

/**
 * Takes the person to the original email, by whatever route the device allows.
 *
 * Browser: the stored Gmail web link, in a new tab.
 *
 * Tablet: the Gmail APP, never the browser (owner, 18.10.2026: the app must work
 * with no dependency on a browser). The Gmail Android app does not claim
 * `mail.google.com` links, so handing it the link sent her to Chrome — or, on the
 * tablet with no browser, nowhere. Instead the app is launched by its package
 * name, and the SUBJECT goes to the clipboard first, so one paste into Gmail's
 * search finds the message. The browser is only the last resort, for a tablet
 * with no Gmail app at all. The caller is told which route was taken so it can
 * say so.
 */
export async function openEmail(messageLink: string, subject?: string): Promise<EmailOpen> {
  if (!isNative()) {
    window.open(messageLink, '_blank', 'noopener')
    return 'opened'
  }

  if (subject) {
    const { copyText } = await import('./clipboard')
    await copyText(subject)
  }
  try {
    const { AppLauncher } = await import('@capacitor/app-launcher')
    // A package name, not a URL: the plugin falls back to the app's launch
    // intent, which is declared in the manifest's <queries>.
    const { completed } = await AppLauncher.openUrl({ url: 'com.google.android.gm' })
    if (completed) return subject ? 'gmail-app' : 'opened'
  } catch {
    // No Gmail app, or the device refused — fall through.
  }

  if (messageLink && await openExternal(messageLink)) return 'opened'
  return subject ? 'copied-subject' : 'copied-link'
}

/**
 * Prints a standalone HTML document that exists only in memory.
 *
 * Browser: the popup window the app has always used.
 * Tablet: `print.html` on the site's own origin, with the document compressed into
 * the URL fragment. A fragment is never sent to the server, so supplier figures
 * stay on the device; `data:` and `blob:` URLs were the obvious alternatives and
 * both are refused by Chrome/Android (see docs/09-ANDROID-APP.md).
 *
 * Deliberately synchronous so the three PDF generators keep their signatures.
 */
export function printHtml(html: string): void {
  if (!isNative()) {
    const w = window.open('', '_blank', 'width=950,height=800')
    if (!w) return
    w.document.write(html)
    w.document.close()
    return
  }
  void printViaChrome(html)
}

async function printViaChrome(html: string): Promise<void> {
  const encoded = await encodePayload(html)
  const url = `${window.location.origin}/print.html#h=${encoded}`
  if (url.length > MAX_PRINT_URL) {
    alert('המסמך ארוך מדי להדפסה מהאפליקציה. אפשר להדפיס אותו מהמחשב.')
    return
  }
  await openExternal(url)
}

async function encodePayload(html: string): Promise<string> {
  const bytes = new TextEncoder().encode(html)
  // CompressionStream is in every WebView new enough to run the app; the plain
  // path keeps an old tablet printing (a bigger URL, still under the guard).
  const CS = (window as unknown as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (!CS) return base64url(bytes) + '.raw'
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('gzip'))
  const packed = new Uint8Array(await new Response(stream).arrayBuffer())
  return base64url(packed) + '.gz'
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a big doc.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Hands the viewer a generated file. Browser: the download the app already did.
 * Tablet: written to the app's cache and offered through Android's share sheet,
 * which is how a file gets to Drive, Gmail or Files from a WebView app — the
 * public Downloads folder is not reachable from here.
 */
export async function saveOrShareFile(fileName: string, blob: Blob): Promise<void> {
  if (!isNative()) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    return
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const data = await blobToBase64(blob)
  const written = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache })
  await Share.share({ title: fileName, files: [written.uri] })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result)
      // readAsDataURL gives "data:<mime>;base64,<payload>"; Filesystem wants the payload.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Opens the tablet's camera and returns the photo as a File.
 *
 * The app's capture screen uses a plain <input type="file">, and inside the
 * WebView that offers a DOCUMENT PICKER, not the camera — because the input also
 * accepts PDFs, Android picks the chooser that can satisfy both. On a shop tablet
 * whose whole job is photographing invoices, that is the wrong door. The native
 * camera is a separate button, so choosing a file stays possible too.
 *
 * Returns null if the user backed out. Throws only on a real failure (permission
 * denied), so the caller can say something useful.
 */
export async function takePhoto(): Promise<File | null> {
  if (!isNative()) return null
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
  const photo = await Camera.getPhoto({
    quality: 85,
    // The document is read by an AI extractor, not by a person — cropping is the
    // photographer's job and editing here only adds a step at the counter.
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    // A shop tablet is shared; the photo has no business in the gallery.
    saveToGallery: false,
  })
  if (!photo.webPath) return null

  const blob = await (await fetch(photo.webPath)).blob()
  const ext = photo.format || 'jpeg'
  return new File([blob], `capture-${Date.now()}.${ext}`, { type: blob.type || `image/${ext}` })
}

export interface AppUpdate {
  /** What is installed on this tablet right now. */
  current: string
  /** What the vendor published. */
  latest: string
  /** Where to get it. Opening this in Chrome starts the install. */
  url: string
  notes?: string
  outdated: boolean
}

/**
 * Asks whether this tablet is running the current SHELL.
 *
 * Worth being precise about what this is not: the system itself updates with the
 * site, so a fix reaches every tablet on the next load with nobody doing
 * anything. This covers the rare other case — a new icon, a new permission, a
 * Capacitor bump — where the APK really did change.
 *
 * Android will not let a sideloaded app install itself silently, so the last tap
 * belongs to the owner. Opening the link in Chrome is what starts the install;
 * the new build carries the same signature, so it lands over the old one and the
 * store code and session survive.
 *
 * Returns null in the browser, or when the check simply cannot be made — an
 * update check that fails must never look like an update that is required.
 */
export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!isNative()) return null
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()

    // A branded build's applicationId ends in the customer's code
    // (com.ctrlplusf.incontrol.hadas), so it already knows which manifest is its
    // own. The generic app has no suffix and reads the shared one.
    // Resolved against the page's own base, not the host root: a customer served
    // from a sub-path would otherwise ask the ROOT for its version and be told
    // about somebody else's build.
    const suffix = info.id.split('.').pop()
    const names = suffix && suffix !== 'incontrol'
      ? [`app/app-version.${suffix}.json`, 'app/app-version.json']
      : ['app/app-version.json']
    const paths = names.map((n) => new URL(n, document.baseURI).href)

    let res: Response | null = null
    for (const path of paths) {
      const attempt = await fetch(path, { cache: 'no-store' })
      if (attempt.ok) { res = attempt; break }
    }
    if (!res) return null
    const manifest = (await res.json()) as {
      versionCode?: number
      versionName?: string
      url?: string
      notes?: string
    }
    if (!manifest.versionCode || !manifest.url) return null

    // build is Android's versionCode — the number Android itself compares, and the
    // only one that cannot be fooled by a version NAME someone typed by hand.
    const installed = Number(info.build)
    return {
      current: info.version,
      latest: manifest.versionName ?? String(manifest.versionCode),
      url: manifest.url,
      notes: manifest.notes,
      outdated: Number.isFinite(installed) && manifest.versionCode > installed,
    }
  } catch {
    return null
  }
}

/**
 * Whether this build carries a customer's address of its own.
 *
 * A branded app has exactly one system it can ever show, so there is nothing to
 * switch to — and offering the control anyway produces a button that appears to
 * do nothing. Returns false in the browser and in the generic app.
 */
export async function isBrandedBuild(): Promise<boolean> {
  if (!isNative()) return false
  const StoreGate = (window as unknown as {
    Capacitor?: { Plugins?: { StoreGate?: { info?: () => Promise<{ branded?: boolean }> } } }
  }).Capacitor?.Plugins?.StoreGate
  try {
    const info = await StoreGate?.info?.()
    return info?.branded === true
  } catch {
    return false
  }
}

/**
 * Forgets which store this tablet belongs to and returns to the gate. Exists so a
 * mistyped code, or a tablet moving between customers, does not mean reinstalling
 * the app. No-op in the browser, where there is no store code to begin with.
 */
export async function resetStoreCode(): Promise<void> {
  if (!isNative()) return
  const { Preferences } = await import('@capacitor/preferences')
  for (const key of STORE_KEYS) await Preferences.remove({ key })

  // Restart rather than navigate. Which system the app points at is read in
  // MainActivity BEFORE the bridge is built, so the gate has to be reached by
  // coming back through onCreate — a navigation would land on a page with no
  // bridge, unable to save the next code. StoreGate is our own tiny plugin;
  // see android/app/src/main/java/com/ctrlplusf/incontrol/StoreGatePlugin.java.
  const StoreGate = (window as unknown as {
    Capacitor?: { Plugins?: { StoreGate?: { restart: () => Promise<void> } } }
  }).Capacitor?.Plugins?.StoreGate
  await StoreGate?.restart()
}

/**
 * Wires the tablet's hardware Back button to the navigation the app already keeps
 * in `window.history` (Layout and EmployeeDashboard both mirror their state there),
 * so neither screen needs to know this exists. At the root it minimizes rather than
 * exits: a stray tap should not end the session.
 *
 * Called once from main.tsx — not from a hook, so it cannot re-register.
 */
export function initNative(): void {
  if (!isNative()) return

  // Tell the shell the system is actually up. MainActivity waits 25s for this and
  // otherwise returns the tablet to the store gate — a white screen (a bad deploy,
  // a WebView too old for the bundle) is invisible to Capacitor's error page, and
  // an app with no address bar leaves nowhere to go. See MainActivity.java.
  const StoreGate = (window as unknown as {
    Capacitor?: { Plugins?: { StoreGate?: { alive?: () => Promise<void> } } }
  }).Capacitor?.Plugins?.StoreGate
  void StoreGate?.alive?.()

  void (async () => {
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back()
      else void App.minimizeApp()
    })
  })()
}
