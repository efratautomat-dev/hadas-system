// ─────────────────────────────────────────────────────────────────────────────
// FUNCTIONAL / SEMANTIC status + alert colors — FIXED for every client.
//
// This is the NON-brand layer: standard traffic-light semantics that must stay
// consistent and legible no matter how the app is reskinned. Do NOT move these
// into src/brand.config.ts and do NOT recolor them per client.
//
//   new         → blue
//   in_progress → orange
//   pending     → yellow   (awaiting / needs a check)
//   done        → green    (done / matched / closed)
//   urgent      → red      (mismatch / error / urgent)
//   neutral     → gray     (cancelled / unknown)
//
// Each token is a soft {bg, fg} pair suited to a badge / pill.
// ─────────────────────────────────────────────────────────────────────────────

export interface Swatch { bg: string; fg: string }

// The five fixed functional colors (+ neutral gray fallback).
export const STATUS = {
  blue:   { bg: '#DBEAFE', fg: '#1E40AF' },
  orange: { bg: '#FFEDD5', fg: '#C2410C' },
  yellow: { bg: '#FEF9C3', fg: '#A16207' },
  green:  { bg: '#DCFCE7', fg: '#166534' },
  red:    { bg: '#FEE2E2', fg: '#DC2626' },
  gray:   { bg: '#F3F4F6', fg: '#6B7280' },
} satisfies Record<string, Swatch>

// Semantic status/alert keys → fixed swatch. What a screen MEANS, mapped once.
export const SEMANTIC = {
  new:         STATUS.blue,
  in_progress: STATUS.orange,
  pending:     STATUS.yellow,
  check:       STATUS.yellow,
  done:        STATUS.green,
  matched:     STATUS.green,
  closed:      STATUS.green,
  mismatch:    STATUS.red,
  urgent:      STATUS.red,
  cancelled:   STATUS.gray,
  neutral:     STATUS.gray,
} satisfies Record<string, Swatch>

export type SemanticKey = keyof typeof SEMANTIC
