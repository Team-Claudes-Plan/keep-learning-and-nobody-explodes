import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'
import { router } from './router'
import SkyBackdrop from './components/SkyBackdrop'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SkyBackdrop />
    <RouterProvider router={router} />
  </StrictMode>,
)
