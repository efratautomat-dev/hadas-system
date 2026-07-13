import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyBrand } from './lib/applyBrand'

// Reskin from src/brand.config.ts before first paint (sets --brand-* vars + title).
applyBrand()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
