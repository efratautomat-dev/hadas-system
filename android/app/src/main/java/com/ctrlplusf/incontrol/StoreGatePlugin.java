package com.ctrlplusf.incontrol;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

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

    /**
     * Whether this build carries its customer's address. A branded app has nothing
     * to switch to, so Settings hides the control rather than showing one that
     * appears to do nothing.
     */
    @PluginMethod
    public void info(PluginCall call) {
        String baked = BuildConfig.STORE_URL;
        JSObject result = new JSObject();
        result.put("branded", baked != null && baked.startsWith("https://"));
        call.resolve(result);
    }

    @PluginMethod
    public void alive(PluginCall call) {
        MainActivity.markAlive();
        call.resolve();
    }

    /**
     * Downloads a new build and hands it to Android's installer.
     *
     * The shop's tablets have no browser — deliberately — so "open the download
     * link" was never going to work there, and every update meant carrying the file
     * in by hand. The app fetches its own update instead: into the cache directory,
     * then out through the FileProvider the project already declares, as an
     * ACTION_VIEW the package installer answers.
     *
     * Android still shows its own confirmation, and asks once for permission to
     * install from this app. That is the law, not a gap: nothing here installs
     * anything silently.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("missing url");
            return;
        }

        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("cannot create " + dir);

                // One fixed name: the previous download is replaced rather than
                // accumulating copies of an app on a device with little room.
                File apk = new File(dir, "update.apk");

                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(30_000);
                conn.setReadTimeout(120_000);
                conn.connect();

                int code = conn.getResponseCode();
                if (code != 200) throw new IOException("server answered " + code);

                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[16 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                conn.disconnect();

                if (apk.length() < 1024) throw new IOException("downloaded file is too small to be an app");

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk
                );

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);

                call.resolve();
            } catch (Exception e) {
                Logger.error("update download failed", e);
                call.reject(e.getMessage() == null ? "download failed" : e.getMessage());
            }
        }).start();
    }
}
