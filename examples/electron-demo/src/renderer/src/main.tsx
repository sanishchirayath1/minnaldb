import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { App } from './App.js'

const root = document.getElementById('root')
if (!root) throw new Error('no #root in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
