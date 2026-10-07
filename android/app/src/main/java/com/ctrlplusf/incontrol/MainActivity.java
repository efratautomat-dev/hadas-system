package com.ctrlplusf.incontrol;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Logger;

/**
 * InControl — decides WHICH system this tablet is before the bridge is built, and
 * makes sure the tablet can always get back out.
 *
 * Capacitor injects its native bridge into exactly one origin, and that origin is
 * fixed when the app starts (Bridge.loadWebView → addDocumentStartJavaScript with a
 * single allowed origin taken from the app URL). Navigating to the customer's site
 * afterwards therefore lands on a page with NO bridge — printing, the Back button,
 * downloads and "switch store" would all silently do nothing. That was measured on
 * a real tablet, not assumed.
 *
 * So the store code is read here, from the same SharedPreferences the Preferences
 * plugin writes to, and becomes `server.url` BEFORE `super.onCreate` builds the
 * bridge. One generic APK still serves every customer; the address just has to be
 * known a moment earlier than a navigation would have provided it.
 *
 * No stored address (first launch) means no server URL, so Capacitor loads the
 * bundled shell — the store gate — instead.
 */
public class MainActivity extends BridgeActivity {

    // Written by @capacitor/preferences (its default group) — see shell/index.html.
    private static final String PREFS = "CapacitorStorage";
    private static final String KEY_URL = "incontrol.storeUrl";
    private static final String KEY_CODE = "incontrol.storeCode";
    private static final String KEY_FAILED = "incontrol.lastFailedUrl";

    // Long enough for a cold start on shop wi-fi with a 2MB bundle, short enough
    // that nobody stands there wondering. A working system answers in under three.
    private static final long WATCHDOG_MS = 25_000;

    private static boolean alive = false;

    /** Called from StoreGatePlugin once the system has actually rendered. */
    static void markAlive() {
        alive = true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(StoreGatePlugin.class);

        // Everything here runs BEFORE super.onCreate, because the bridge is built
        // there and the address has to be decided first. That also means a failure
        // here kills onCreate before anything is loaded — which on screen looks
        // exactly like a white page, with no error anywhere to read. It happened on
        // a real tablet. So the whole decision is defensive: if any part of it
        // throws, the app falls back to loading its local shell, which can at least
        // say something.
        String storeUrl = null;
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            storeUrl = prefs.getString(KEY_URL, null);
            // One shot, not a life sentence. The flag exists to stop a tablet
            // looping back into a site that just failed to come up — one launch
            // later the network may be back, the deploy may be fixed, and the app
            // may even have been reinstalled. Reading it clears it, so the next
            // start tries the address again instead of refusing it forever.
            String failed = prefs.getString(KEY_FAILED, null);
            if (failed != null) prefs.edit().remove(KEY_FAILED).apply();

            // A constant compiled into the app: no Resources, no Context, nothing
            // that can fail this early. Reading a string resource here is the most
            // likely cause of the blank screens that sent us in circles — on the
            // tablet where it happened, the fallback below is what finally showed
            // something instead of nothing.
            String baked = BuildConfig.STORE_URL;

            // A BRANDED build belongs to exactly one customer, so its baked address
            // wins outright — a stored one can only be a leftover. A tablet used for
            // testing kept the demo address it had been given, survived the update
            // (preferences do), and opened the demo instead of the shop's system.
            //
            // The generic build has no baked address and keeps what the tablet was
            // told; that is what its store gate is for.
            //
            // Either way an address the watchdog just rejected is not re-used, or a
            // tablet would loop back into a broken site forever.
            if (baked != null && baked.startsWith("https://")) {
                storeUrl = baked.equals(failed) ? null : baked;
            } else if (storeUrl != null && storeUrl.equals(failed)) {
                storeUrl = null;
            }

            if (storeUrl != null && storeUrl.startsWith("https://")) {
                // A programmatic config REPLACES capacitor.config.json wholesale, so
                // everything the app relies on has to be repeated here. Keep this in
                // step with capacitor.config.ts — one setting in two places.
                // NO allowNavigation here, and that is the point. Every entry in it
                // is registered as an authority on Capacitor's LOCAL asset server
                // (WebViewLocalServer.java:704), so the WebView serves those hosts
                // out of the APK instead of fetching them. A "*" therefore told the
                // app to intercept the entire internet and answer from files that do
                // not exist — the customer's site never loaded, and the screen showed
                // the offline page on a tablet with a working connection.
                //
                // server.url is allowed by definition; nothing else needs to be.
                config =
                    new CapConfig.Builder(this)
                        .setServerUrl(storeUrl)
                        .setErrorPath("offline.html")
                        .setAndroidScheme("https")
                        .create();
            } else {
                storeUrl = null;
            }
        } catch (Exception e) {
            // Better a store gate than a blank screen nobody can diagnose.
            Logger.error("could not resolve the store address — falling back to the shell", e);
            config = null;
            storeUrl = null;
        }

        super.onCreate(savedInstanceState);

        if (storeUrl != null) {
            startWatchdog(getSharedPreferences(PREFS, MODE_PRIVATE), storeUrl);
        }
    }

    /**
     * A site that fails to LOAD gets Capacitor's error page. A site that loads and
     * then breaks — a bad deploy, a WebView too old for the bundle — shows a white
     * screen instead, and an app with no address bar offers no way off it. This is
     * the way off: if the system has not reported in, forget the address and come
     * back through the store gate with an explanation.
     */
    private void startWatchdog(SharedPreferences prefs, String storeUrl) {
        alive = false;
        new Handler(Looper.getMainLooper())
            .postDelayed(
                () -> {
                    if (alive || isFinishing() || isDestroyed()) return;
                    prefs
                        .edit()
                        .remove(KEY_URL)
                        .remove(KEY_CODE)
                        // Both keys go, or the gate would resolve the same broken
                        // address again and the tablet would loop. The address is
                        // kept only so the gate can name what failed.
                        .putString(KEY_FAILED, storeUrl)
                        .apply();
                    recreate();
                },
                WATCHDOG_MS
            );
    }
}
