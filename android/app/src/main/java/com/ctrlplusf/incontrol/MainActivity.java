package com.ctrlplusf.incontrol;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

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

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String storeUrl = prefs.getString(KEY_URL, null);
        boolean remote = storeUrl != null && storeUrl.startsWith("https://");

        if (remote) {
            // A programmatic config REPLACES capacitor.config.json wholesale, so
            // everything the app relies on has to be repeated here. Keep this in
            // step with capacitor.config.ts — the two are one setting in two places.
            config =
                new CapConfig.Builder(this)
                    .setServerUrl(storeUrl)
                    .setErrorPath("offline.html")
                    .setAndroidScheme("https")
                    .setAllowNavigation(new String[] { "*" })
                    .create();
        }

        super.onCreate(savedInstanceState);

        if (remote) startWatchdog(prefs, storeUrl);
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
