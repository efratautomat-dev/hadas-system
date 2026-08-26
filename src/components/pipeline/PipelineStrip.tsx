import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { STATUS } from '../../theme/status'
import type { PipelineStage } from '../../data/mockData'
import { stepsForStage, type StepState, type OrderLink } from '../../lib/pipelineSteps'

// ── The goods pipeline, drawn ────────────────────────────────────────────────
//
//   הזמנה → סחורה → חשבונית → אישור → בכרטסת
//
// One component, used wherever a delivery is shown: the tracking list, the
// supplier card, the approval screen. The stage is the truth; this is how it is
// read at a glance. The StatusBadge beside it is the same fact in one word — the
// strip says WHERE, the badge says WHAT, and neither invents a vocabulary.
//
// The rule for which step is reached when lives in `lib/pipelineSteps.ts`, not
// here — including why the order step has a third "does not apply" state.

const BOX: Record<StepState, CSSProperties> = {
  done:    { background: STATUS.green.bg, borderColor: STATUS.green.fg, color: STATUS.green.fg },
  current: { background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', color: '#FFFFFF' },
  todo:    { background: '#FFFFFF', borderColor: '#E2E4E9', color: '#C9C7CC' },
  missing: { background: STATUS.red.bg, borderColor: STATUS.red.fg, color: STATUS.red.fg },
  na:      { background: '#F8F8FA', borderColor: '#E2E4E9', color: '#B9B7BD', borderStyle: 'dashed' },
}

export function PipelineStrip({
  stage,
  order = 'none',
  compact = false,
  showLabels = true,
}: {
  /** `null` when the order has not arrived — nothing is in the pipeline yet. */
  stage: PipelineStage | null
  order?: OrderLink
  /** Row-sized: smaller boxes, for a table cell. */
  compact?: boolean
  /** Off in the tightest rows, where the strip is a shape and the badge carries the words. */
  showLabels?: boolean
}) {
  const steps = stepsForStage(stage, order)
  const size = compact ? 24 : 30
  const font = compact ? 11 : 12.5

  return (
    <div
      className="inline-flex items-center"
      role="img"
      // The whole strip is one image to a screen reader; reading five cubes and
      // four connectors aloud is noise, and the badge next to it already carries
      // the state in a word.
      aria-label={`שלב: ${steps.filter(s => s.state === 'done').length} מתוך ${steps.length}`}
    >
      {steps.map((step, i) => (
        <div key={step.key} className="inline-flex items-center">
          {i > 0 && (
            <i
              aria-hidden="true"
              style={{
                width: compact ? 14 : 20,
                height: 1.5,
                marginBottom: showLabels ? (compact ? 13 : 15) : 0,
                // Green once the step BEFORE it is behind us, so the coloured run
                // reads as "how far this got". `na` counts as behind us: a delivery
                // with no order is not held up by one, and breaking the run there
                // would draw the normal case as if something were missing.
                background: steps[i - 1].state === 'done' || steps[i - 1].state === 'na'
                  ? STATUS.green.fg : '#E2E4E9',
              }}
            />
          )}
          <div className="relative flex flex-col items-center" style={{ gap: 5 }}>
            <div
              className="grid place-items-center font-bold"
              style={{
                width: size, height: size, fontSize: font,
                border: '1.5px solid', borderStyle: 'solid',
                ...BOX[step.state],
              }}
            >
              {step.state === 'done'    ? <Check style={{ width: font, height: font }} strokeWidth={3} />
               : step.state === 'missing' ? '!'
               : step.state === 'na'      ? '–'
               : i + 1}
              {step.state === 'missing' && (
                <i
                  aria-hidden="true"
                  className="absolute rounded-full"
                  style={{
                    top: -3, insetInlineStart: -3, width: 10, height: 10,
                    background: STATUS.red.fg, border: '2px solid #FFFFFF',
                  }}
                />
              )}
            </div>
            {showLabels && (
              <small
                style={{
                  fontSize: compact ? 10 : 10.5,
                  whiteSpace: 'nowrap',
                  fontWeight: step.state === 'todo' || step.state === 'na' ? 400 : 600,
                  color: step.state === 'todo' || step.state === 'na' ? '#9CA3AF' : '#1F2125',
                }}
              >
                {step.label}
              </small>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default PipelineStrip
