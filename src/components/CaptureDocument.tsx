import { useRef, useState } from 'react'
import { Camera, FileText, Truck, RotateCcw, Upload, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { captureDocument, type CaptureDocType, type CaptureResult } from '../lib/api'

interface Props {
  capturedBy?: string
}

// UI offers four choices; חזרה and זיכוי both run the return_doc pathway (identical
// to the email pipeline, which matches a supplier credit-note against an open return).
interface TypeOption {
  key:     string
  label:   string
  docType: CaptureDocType
  Icon:    typeof FileText
}

const TYPE_OPTIONS: TypeOption[] = [
  { key: 'invoice',   label: 'חשבונית',      docType: 'invoice',       Icon: FileText },
  { key: 'delivery',  label: 'תעודת משלוח',  docType: 'delivery_note', Icon: Truck },
  { key: 'return',    label: 'חזרה',         docType: 'return_doc',    Icon: RotateCcw },
  { key: 'credit',    label: 'זיכוי',        docType: 'return_doc',    Icon: RotateCcw },
]

const ACCENT = 'var(--brand-primary)'
const ACCENT_BG = 'var(--brand-active-bg)'

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('קריאת הקובץ נכשלה'))
    reader.readAsDataURL(file)
  })
}

export default function CaptureDocument({ capturedBy }: Props) {
  const [selected, setSelected] = useState<TypeOption | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onPickType = (opt: TypeOption) => {
    setSelected(opt)
    reset()
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setError('יש לצלם או לבחור קובץ תמונה בלבד')
      return
    }
    setError(null)
    setResult(null)
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(f))
  }

  const onUpload = async () => {
    if (!selected || !file) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const dataUrl = await readAsDataUrl(file)
      const res = await captureDocument({
        docType:     selected.docType,
        imageBase64: dataUrl,
        mimeType:    file.type,
        filename:    file.name,
        capturedBy,
      })
      setResult(res)
      if (res.ok) {
        // Clear the image so the next capture starts fresh, but keep the type picked.
        setFile(null)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ההעלאה נכשלה')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', direction: 'rtl' }}>
      {/* Heading */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: ACCENT_BG }}>
          <Camera className="w-6 h-6" style={{ color: ACCENT }} />
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#1A1A2E' }}>צילום מסמך</h1>
          <p className="text-sm" style={{ color: '#9CA3AF' }}>בחרי סוג מסמך, צלמי והעלי למערכת</p>
        </div>
      </div>

      {/* Step 1 — type picker */}
      <div className="mb-6">
        <p className="text-sm font-medium mb-3" style={{ color: '#6B7280' }}>1. סוג המסמך</p>
        <div className="grid grid-cols-2 gap-3">
          {TYPE_OPTIONS.map((opt) => {
            const active = selected?.key === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => onPickType(opt)}
                className="flex items-center gap-3 rounded-2xl border transition-all"
                style={{
                  padding: '14px 16px',
                  borderColor: active ? ACCENT : '#EEEEF2',
                  background: active ? ACCENT_BG : '#FFFFFF',
                  color: active ? ACCENT : '#374151',
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 500,
                }}
              >
                <opt.Icon className="w-5 h-5 flex-shrink-0" />
                <span style={{ fontSize: '15px' }}>{opt.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Step 2 — capture / preview */}
      {selected && (
        <div className="mb-6">
          <p className="text-sm font-medium mb-3" style={{ color: '#6B7280' }}>2. צילום המסמך</p>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />

          {!previewUrl ? (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all"
              style={{ borderColor: '#E5D5DA', background: '#FFFFFF', padding: '40px 20px', color: ACCENT, cursor: 'pointer' }}
            >
              <Camera className="w-9 h-9 mb-2" />
              <span style={{ fontSize: '15px', fontWeight: 600 }}>צלמי או בחרי תמונה</span>
              <span style={{ fontSize: '13px', color: '#9CA3AF', marginTop: '4px' }}>
                במובייל תיפתח המצלמה אוטומטית
              </span>
            </button>
          ) : (
            <div className="relative rounded-2xl overflow-hidden border" style={{ borderColor: '#EEEEF2' }}>
              <img src={previewUrl} alt="תצוגה מקדימה" style={{ width: '100%', display: 'block', maxHeight: '420px', objectFit: 'contain', background: '#0b0b0f' }} />
              <button
                onClick={reset}
                className="absolute flex items-center justify-center rounded-full"
                style={{ top: '10px', left: '10px', width: '34px', height: '34px', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', cursor: 'pointer' }}
                title="הסרה"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3 — upload */}
      {selected && previewUrl && (
        <button
          onClick={onUpload}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 rounded-2xl transition-all"
          style={{
            padding: '15px',
            background: uploading ? '#E59AAA' : ACCENT,
            color: 'white',
            border: 'none',
            fontSize: '16px',
            fontWeight: 600,
            cursor: uploading ? 'default' : 'pointer',
          }}
        >
          {uploading
            ? <><Loader2 className="w-5 h-5 animate-spin" /> מעלה ומעבד…</>
            : <><Upload className="w-5 h-5" /> העלה למערכת</>}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl mt-4" style={{ background: '#FFF0EF', padding: '14px 16px' }}>
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#E8645A' }} />
          <span style={{ color: '#B23B3B', fontSize: '14px' }}>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && result.ok && (
        <div className="flex items-start gap-3 rounded-2xl mt-4" style={{ background: '#ECFDF3', padding: '16px' }}>
          <CheckCircle2 className="w-6 h-6 flex-shrink-0" style={{ color: '#0E9F6E' }} />
          <div>
            <p style={{ color: '#03543F', fontSize: '15px', fontWeight: 600 }}>
              {result.outcome === 'skipped' ? 'המסמך כבר קיים במערכת' : 'המסמך נקלט בהצלחה'}
            </p>
            <p style={{ color: '#057A55', fontSize: '13px', marginTop: '2px' }}>
              {result.outcome === 'alerted'
                ? 'נשמר, אך נדרשת בדיקה ידנית — בדקי בהתראות.'
                : 'הופעל אותו תהליך חילוץ והעלאה כמו במסמכים שמגיעים במייל.'}
            </p>
            <button
              onClick={() => setResult(null)}
              className="rounded-xl mt-3"
              style={{ background: '#FFFFFF', color: ACCENT, border: `1px solid ${ACCENT}`, padding: '8px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              צילום מסמך נוסף
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="flex items-start gap-2 rounded-2xl mt-4" style={{ background: '#FFF0EF', padding: '14px 16px' }}>
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#E8645A' }} />
          <span style={{ color: '#B23B3B', fontSize: '14px' }}>
            {result.error ?? 'העיבוד נכשל. נסי שוב או בדקי את החיבור.'}
          </span>
        </div>
      )}
    </div>
  )
}
