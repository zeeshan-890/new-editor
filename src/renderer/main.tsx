import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from './components/layout/AppShell'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </StrictMode>
)
