import { getDemoRole, setDemoRole, ROLE_LABEL, type DemoRole } from '../lib/demoGate'
import { currentTier, TIERS } from '../lib/tiers'

// A small floating pill, rendered ONLY in the standalone demo build, that flips the
// visitor between the manager view and the employee view without asking for the
// password again.
//
// It reloads the page on purpose. The role is resolved once, on mount, by
// useAuth.fetchRole() reading `allowed_users` — mirroring how the real system works,
// where a person's role does not change mid-session. Adding a live role-swap path to
// useAuth would mean carrying demo-only complexity through the auth code that guards
// the real system, to save the visitor a one-second reload. Not worth it.

export default function DemoRoleSwitcher() {
  const current = getDemoRole()
  const other: DemoRole = current === 'manager' ? 'employee' : 'manager'
  const tier = TIERS[currentTier()]

  const swap = () => {
    setDemoRole(other)
    window.location.reload()
  }

  return (
    <button
      onClick={swap}
      title={`מסלול ${tier.label} · ${tier.tagline} — לחצו למעבר לתצוגת ${ROLE_LABEL[other]}`}
      style={{
        position: 'fixed',
        // Physical left, not inset-inline: the app is RTL, so the sidebar (and the
        // signed-in user block at its foot) sits on the right. Anchoring to the
        // logical start would park this pill on top of it.
        left: '16px',
        bottom: '16px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '9px 14px',
        borderRadius: '999px',
        border: '1px solid #E2E4E9',
        background: 'white',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        fontSize: '13px',
        fontFamily: 'inherit',
        color: '#4B5563',
        cursor: 'pointer',
        direction: 'rtl',
      }}
    >
      <span
        style={{
          background: 'var(--brand-primary-dark)',
          color: 'white',
          borderRadius: '999px',
          padding: '2px 8px',
          fontSize: '11px',
          fontWeight: 700,
        }}
      >
        מסלול {tier.label}
      </span>
      <span>מעבר לתצוגת {ROLE_LABEL[other]}</span>
    </button>
  )
}
