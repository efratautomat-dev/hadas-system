import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyBrand } from './lib/applyBrand'
import { initNative } from './lib/native'

// Reskin from src/brand.config.ts before first paint (sets --brand-* vars + title).
applyBrand()

// Wires the Android tablet's hardware Back button to the history stack the app
// already keeps. No-op in the browser. See src/lib/native.ts.
initNative()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
