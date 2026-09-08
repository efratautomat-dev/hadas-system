import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The shop runs on tablets, and a tablet's WebView is whatever its owner last
    // updated — which on an older device can be years behind. Vite's default target
    // emits syntax (logical assignment, private fields) that such a WebView cannot
    // parse, and an unparseable bundle is a WHITE SCREEN with no error anyone sees.
    // Measured on a real Android 10 tablet, in the browser and in the app alike.
    //
    // chrome73 (2019) covers every device we have reason to support. It was picked
    // by scanning the built bundle rather than guessing: apart from the syntax above,
    // the only feature the system uses beyond it is Object.hasOwn, polyfilled in
    // index.html. Raise this only after re-checking what the bundle actually needs.
    target: 'chrome73',
  },
})
