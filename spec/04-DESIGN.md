# 04 — Design

> Modern, clean RTL admin/SaaS dashboard, based on the Stitch reference the owner selected,
> re-skinned in the Hadas brand palette. Calm, airy, rounded cards, soft shadows, semantic
> status colors. Font: Heebo.

## Brand palette (sampled from the Hadas logo)
| Token | Hex | Use |
|---|---|---|
| primary (burgundy) | #A91D3A | primary buttons, active nav, headers, key accents |
| primary-dark | #8C1733 | hover / pressed |
| secondary (coral) | #F5847C | secondary accents, highlights, tags |
| coral-tint | #F9BAB5 | soft fills, hover backgrounds |
| coral-bg | #FDEEEC | light section backgrounds |
| accent (mustard) | #F3B335 | small highlights / attention |
| background | #F8F8FA | app background |
| surface | #FFFFFF | cards |
| text | #1F2125 | primary text |
| text-muted | #6B6E73 | secondary text |
| border | #ECECEF | dividers, borders |

## Typography (Heebo)
| Style | Size | Weight | Line-height |
|---|---|---|---|
| Page title | 28px | 700 | 36px |
| Section title | 20px | 600 | 28px |
| Card title | 16px | 600 | 24px |
| Body | 15px | 400 | 24px |
| Label / caption | 13px | 500 | 18px |
| Button | 15px | 600 | 20px |

## Buttons
- Primary: burgundy bg (#A91D3A), white text, radius 10px, padding 10px 18px; hover #8C1733.
- Secondary: white bg, burgundy text + 1px burgundy border; hover coral-bg fill.
- Ghost: transparent, text-muted; hover coral-bg.
- Destructive: semantic red (#DC2626) text/border.
- Disabled: 40% opacity.

## Status colors (semantic; bind to 06-RULES taxonomy)
new=blue #3B82F6 · in_progress=orange #F3B335 · done=green #16A34A · cancelled=gray #9CA3AF ·
mismatch=red #DC2626 · matched=green #16A34A. StatusBadge MUST gray-fallback on unknown.

## Components
Cards (white, radius 12px, soft shadow, optional status edge-accent) · status pills · thin
progress bars · filter chips + "נקה הכל" · list/grid toggle · file dropzone (dashed, cloud
icon) · numbered pagination (active=burgundy) · right-aligned tables with light header fill.

## Layout (RTL)
Right sidebar nav (active item burgundy with rounded indicator): לוח בקרה · ספקים · חשבוניות ·
תשלומים · תעודות משלוח · חזרות · התאמות · התראות · הגדרות. Top bar: centered search,
notifications bell (red dot), help, avatar. Numbers/currency LTR inside RTL. Logo top-right.

## Responsive — tablet + desktop (no small mobile)
Target devices: desktop and tablet only. Every screen must work well on both. Built on
Tailwind's built-in breakpoints.

| Breakpoint | Width | Behavior |
|---|---|---|
| Desktop | ≥ 1024px (`lg`) | Full layout: sidebar expanded, multi-column card grid, full tables. |
| Tablet | 768–1024px (`md`) | Sidebar collapses to icons (or toggles open); card grid drops to 1–2 columns; tables scroll horizontally OR become stacked cards; touch-sized controls. |

Rules:
- Minimum touch target 44×44px for any tappable element (tablet is used by finger).
- Goods-receipt / capture screen is the most touch-critical: large buttons, generous inputs,
  easy photo/upload. Design it touch-first.
- Wide tables (ledger, invoices, payments): on tablet, either horizontal scroll within the
  card, or collapse each row into a stacked card. Never let a table overflow the viewport.
- Forms: single-column on tablet; labels above fields.
- Sidebar: on tablet, default to icon-rail; expand on tap.

## ⚠️ TO BE EXPANDED BY OWNER — spacing scale, component states, empty states.
