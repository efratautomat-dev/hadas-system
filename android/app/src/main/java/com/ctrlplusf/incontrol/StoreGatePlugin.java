package com.ctrlplusf.incontrol;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The two native calls the web side needs.
 *
 * `restart()` — which system the app points at is decided in MainActivity, before
 * the bridge exists (see the comment there). So after the store gate saves a new
 * address — a first install, or "switch store" from Settings — the only way to
 * apply it is to come back through onCreate. `recreate()` does that in place: same
 * task, same back stack, no reinstall, about a second on screen.
 *
 * `alive()` — the system calls this once it has booted (src/lib/native.ts). It is
 * what tells MainActivity's watchdog that the tablet is looking at a working
 * screen. A site that loads but then crashes shows a WHITE page: the error page
 * never fires, and without this signal the tablet is stuck there with no way back
 * except clearing app data. Measured, not imagined — it happened on the first
 * tablet we tested.
 */
@CapacitorPlugin(name = "StoreGate")
public class StoreGatePlugin extends Plugin {

    @PluginMethod
    public void restart(PluginCall call) {
        // Resolve first: recreate() tears down the WebView, and a reply sent after
        // that has nowhere to land.
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void alive(PluginCall call) {
        MainActivity.markAlive();
        call.resolve();
    }
}
