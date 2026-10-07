import { useEffect, useRef, useState } from 'react'

// PdfCanvas — draws a PDF, page by page, into <canvas>.
//
// Only the Android app needs this. A browser renders a PDF in an <iframe> for
// free; the Android WebView has no PDF engine at all, so the same iframe is a
// blank rectangle. Sending the owner out to Chrome works, but reviewing an
// invoice means leaving the app and coming back for every document — which is
// not reviewing, it is commuting.
//
// pdf.js is loaded lazily, so the browser bundle never fetches it.
//
// LIMIT worth knowing: this fetches the file's BYTES, so it needs a URL that
// allows cross-origin reads. Supabase signed URLs do. A Google Drive /preview
// link does not (and would need a Google session the WebView cannot hold), so
// the caller keeps the "open externally" path for those.

interface Props {
  url: string
  onFail: () => void
}

export default function PdfCanvas({ url, onFail }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return

    void (async () => {
      try {
        // The LEGACY build, and a worker that is allowed to fail.
        //
        // pdf.js ships an ES-module worker, which an older tablet WebView cannot
        // start — and when it cannot, the document silently became "open it in the
        // browser", on a tablet that has no browser. Rendering a few pages on the
        // main thread is slower; showing nothing is useless. So the worker is an
        // optimisation here, not a requirement.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        try {
          const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        } catch (workerErr) {
          console.warn('[PdfCanvas] no worker — rendering on the main thread', workerErr)
        }

        const doc = await pdfjs.getDocument({
          url,
          withCredentials: false,
          // Both off for an old engine: eval is blocked in many WebViews, and the
          // worker-side fetch is the part that fails when there is no worker.
          isEvalSupported: false,
          useWorkerFetch: false,
        }).promise
        if (cancelled) return

        host.replaceChildren()
        // Render at the device's pixel density, capped: an A4 page at 3x on a
        // tablet is a 25MB canvas, and the WebView kills the tab rather than
        // telling anyone why.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          if (cancelled) return

          const base = page.getViewport({ scale: 1 })
          const scale = (host.clientWidth || 600) / base.width
          const viewport = page.getViewport({ scale: scale * dpr })

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.style.display = 'block'
          canvas.style.marginBottom = '8px'
          canvas.style.background = 'white'

          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await page.render({ canvas, canvasContext: ctx, viewport }).promise
          if (cancelled) return
          host.appendChild(canvas)
        }
        setStatus('ready')
      } catch (err) {
        // A PDF we cannot fetch or parse is not an error to argue with — hand the
        // caller back its fallback rather than showing a dead panel. The message is
        // kept visible in the console because "the document just does not show" was
        // the hardest thing to diagnose on a tablet we cannot attach a debugger to.
        console.error('[PdfCanvas] could not render:', err)
        if (!cancelled) onFail()
      }
    })()

    return () => { cancelled = true }
  }, [url, onFail])

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#F3F4F6' }}>
      {status === 'loading' && (
        <p style={{ textAlign: 'center', color: '#6B7280', fontSize: '13px', padding: '24px' }}>
          טוען את המסמך…
        </p>
      )}
      <div ref={hostRef} />
    </div>
  )
}
