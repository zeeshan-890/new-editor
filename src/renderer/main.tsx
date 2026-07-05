import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorShell } from './components/layout/EditorShell'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorShell />
  </StrictMode>
)
