import { LogOut } from 'lucide-react'

interface Props {
  userEmail: string
  onSignOut: () => Promise<void>
}

export default function WaitingScreen({ userEmail, onSignOut }: Props) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F4F5F7',
        direction: 'rtl',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '24px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          maxWidth: '460px',
          width: '90%',
          padding: '48px 40px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '52px', marginBottom: '20px' }}>💜</div>

        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1F2937', marginBottom: '12px' }}>
          המסך שלך נמצא בפיתוח
        </h1>

        <p style={{ color: '#6B7280', lineHeight: 1.7, marginBottom: '8px' }}>
          בקרוב כאן יופיעו הפעולות שלך 💜
        </p>

        <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '28px' }}>
          לשאלות פנו למנהלת:{' '}
          <a
            href="mailto:h8420785@gmail.com"
            style={{ color: '#8B1A3A', textDecoration: 'none' }}
          >
            h8420785@gmail.com
          </a>
        </p>

        <div
          style={{
            background: '#F4F5F7',
            borderRadius: '12px',
            padding: '10px 16px',
            fontSize: '14px',
            color: '#6B7280',
            marginBottom: '24px',
          }}
        >
          מחוברת בתור:{' '}
          <span style={{ color: '#374151', fontWeight: 500 }}>{userEmail}</span>
        </div>

        <button
          onClick={onSignOut}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: '#FFF0EF',
            color: '#E8645A',
            border: 'none',
            borderRadius: '12px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#FFE0DE')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#FFF0EF')}
        >
          <LogOut style={{ width: '16px', height: '16px' }} />
          התנתקות
        </button>
      </div>
    </div>
  )
}
