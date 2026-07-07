import { useState } from 'react'
import { Eye, X, ExternalLink } from 'lucide-react'

// Convert any Drive URL form (/view, /edit, /open, ?usp=...) into a /preview URL
// suitable for embedding in an iframe. Falls back to the original URL if it
// doesn't look like a Drive file link.
export function toDrivePreview(url: string): string {
  if (!url) return ''
  // Match Google Drive file ID in standard formats
  const m = url.match(/\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&]+)/)
  if (m && m[1]) return `https://drive.google.com/file/d/${m[1]}/preview`
  // If it looks like a Drive URL with /view, swap to /preview
  if (url.includes('drive.google.com')) {
    return url.replace(/\/view(\?.*)?$/, '/preview').replace(/\/edit(\?.*)?$/, '/preview')
  }
  return url
}

interface PdfPreviewModalProps {
  url: string
  // When provided, used directly as the iframe src (already a final URL, e.g. a
  // signed storage URL). When omitted, the src is derived from `url` via
  // toDrivePreview() — the original Drive-link behavior.
  previewSrc?: string
  onClose: () => void
}

export function PdfPreviewModal({ url, previewSrc, onClose }: PdfPreviewModalProps) {
  const previewUrl = previewSrc ?? toDrivePreview(url)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ width: '100%', maxWidth: '900px', height: '90vh', direction: 'rtl' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: '#E2E4E9', background: '#FAFAFC' }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg flex items-center justify-center transition-colors"
              style={{ background: '#F3F4F6', width: '36px', height: '36px', color: '#6B7280' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#E5E7EB')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#F3F4F6')}
              title="סגור"
            >
              <X className="w-5 h-5" />
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg font-semibold transition-colors"
              style={{ background: '#FDF2F4', color: '#A91D3A', padding: '8px 14px', fontSize: '13px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FAE6E9')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDF2F4')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {previewSrc ? 'פתח בכרטיסייה חדשה' : 'פתח ב-Drive'}
            </a>
          </div>
          <h3 className="font-bold text-gray-800" style={{ fontSize: '15px' }}>תצוגה מקדימה</h3>
        </div>

        {/* Iframe */}
        <div className="flex-1" style={{ background: '#F3F4F6' }}>
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title="PDF preview"
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="autoplay"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              לא ניתן להציג תצוגה מקדימה לקישור זה
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface PdfPreviewButtonProps {
  url: string
  title?: string
  size?: number
}

// Eye icon button — clicking opens the PDF preview modal for the given URL.
// Renders nothing when url is empty so callers can drop it in unconditionally.
export function PdfPreviewButton({ url, title = 'תצוגה מקדימה', size = 16 }: PdfPreviewButtonProps) {
  const [open, setOpen] = useState(false)
  if (!url) return null
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px',
          borderRadius: '8px',
          border: '1px solid #DEDFE5',
          background: 'white',
          color: '#A91D3A',
          cursor: 'pointer',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#FDF2F4')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
      >
        <Eye size={size} />
      </button>
      {open && <PdfPreviewModal url={url} onClose={() => setOpen(false)} />}
    </>
  )
}
