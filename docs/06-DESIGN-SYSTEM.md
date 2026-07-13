# 06 — Design System

> Visual language and RTL conventions. Token values verified from `tailwind.config.js`; other
> values are read from inline component styles (the app styles largely with Tailwind classes +
> inline `style` objects rather than a central theme file).

## Brand color tokens (`tailwind.config.js → theme.extend.colors`)
| Token | Hex | Use |
|---|---|---|
| `primary` | `#D32F4A` | brand red — primary buttons, accents |
| `primary-dark` | `#A8213B` | hover / pressed |
| `primary-soft` | `#F4A5B0` | soft accents |
| `accent` | `#F2C94C` | secondary accent (gold) |
| `background` | `#F8F8FA` | page background |
| `surface` | `#FFFFFF` | cards / panels |
| `border` | `#EEEEF2` | light dividers |
| `border-input` | `#DEDFE5` | form field borders |
| `active-bg` | `#FDF2F4` | active/selected soft red background |
| `text-primary` | `#1A1A2E` | main text |
| `text-muted` | `#6B7280` | secondary text |

Login uses a brand gradient `linear-gradient(135deg,#8B1A3A,#E8645A)` (from inline style).

## Status badge palette (used consistently across screens)
| Meaning | Background | Text |
|---|---|---|
| waiting `ממתין` | `#FEF9C3` | `#A16207` |
| done `שולם`/`הושלם` | `#DCFCE7` | `#166534` |
| in-progress `בטיפול` | `#DBEAFE` | `#1E40AF` |
| in-transit `בדרך` | `#EDE9FE` | `#5B21B6` |
| error `שגיאה` | `#FEE2E2` | `#DC2626` |

## Alert severity buckets (`src/components/Alerts.tsx`)
| Bucket | Background / Text | Example types |
|---|---|---|
| Urgent (red) | `#FEE2E2` / `#B91C1C` | `invoice_ingest_failed`, `invoice_duplicate`, `duplicate_invoice` |
| Action (orange) | `#FFEDD5` / `#C2410C` | `supplier_incomplete`, `supplier_details_review`, `unmatched_credit_note`, `statement_save_failed` |
| Check (yellow) | `#FEF9C3` / `#B45309` | `invoice_low_confidence`, `document_misclassified`, `invoice_no_attachment`, `invoice_link_failed` |
| Info (gray) | `#F3F4F6` / `#6B7280` | `invoice_old_date` |

Unknown alert types fall back to a neutral gray badge (defensive default).

## Supplier category colors (`src/components/Suppliers.tsx`)
Nine hard-coded categories, each `{bg / text}`: `ספקים ביגוד` `#EFF6FF`/`#1D4ED8`;
`ספקים כיסויי ראש` `#FDF4FF`/`#9333EA`; `ספקים בגדי ים` `#F0FDFA`/`#0F766E`;
`ספקים שונות` `#F3F4F6`/`#4B5563`; `הוצאות ניהול` `#FFF7ED`/`#C2410C`;
`הוצאות משרד` `#FEF9C3`/`#92400E`; `תשלומי מס הכנסה` `#FFF1F2`/`#BE123C`;
`משכורות` `#F0FDF4`/`#16A34A`; `שונות` `#F3F4F6`/`#6B7280`.

> ⚠️ NEEDS OWNER CONFIRMATION — this UI category list (9) does not exactly match the seeded
> `categories` table (10, includes `תשלומי מעמ` and `ספקים כיסויי ראש ומטפחות`). See 07.

## Typography
- Font: **Rubik** (`fontFamily.rubik = ['Rubik','system-ui','sans-serif']`), Hebrew-optimized.
- Weights in use: 400 / 500 / 600 / 700 / 900 (900 for headings).
- PDFs (`src/utils/pdf/pdfConfig.ts`) fall back to Arial for print and use
  `print-color-adjust: exact` to preserve brand colors on paper (A4).

## Spacing, radius, shadow (from inline styles)
- Sidebar widths: 256 (desktop) / 200 (tablet) / 72 (collapsed) / 0 (mobile).
- Content padding: 32 / 20 / 12 px by breakpoint.
- Radius: 24 (large cards) / 16 (medium) / 12 (buttons) / 8 (small).
- Shadows: `0 1px 2px rgba(0,0,0,.05)` (cards); `0 4px 24px rgba(0,0,0,.08)` (login card);
  `0 4px 14px rgba(211,47,74,.30)` (accent button).

## Responsive breakpoints (`Layout.tsx`)
- Mobile `< 640px` (hamburger + slide-out sidebar), Tablet `640–1024px`, Desktop `> 1024px`.

## RTL conventions
- Root and main containers set `direction:'rtl'`; `index.html` is `lang="he" dir="rtl"`.
- **SectionHeader** flips a container to `direction:'ltr'` for predictable flex ordering, then
  restores `rtl` inside clusters — the canonical fix for the recurring RTL flex flip.
- URLs / links / numeric refs render `dir="ltr"` so they read left-to-right inside RTL text.
- The ingest overflow folder name is built via `String.fromCharCode` to avoid RTL scrambling of
  source (see 04 §E3). Source code generally avoids raw Hebrew literals where they'd reorder.

## Logo
- `/logo.png` in Sidebar (~40px), Login (~56px), and Settings; also `public/store-logo.png.jpeg`
  and `favicon.png`/`favicon.svg`. App logo is also managed at runtime via `useAppLogo`.
