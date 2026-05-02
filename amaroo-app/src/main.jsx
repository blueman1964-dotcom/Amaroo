import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { DataRefreshProvider } from './context/DataRefreshContext.jsx'

registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DataRefreshProvider>
      <App />
    </DataRefreshProvider>
  </StrictMode>,
)
