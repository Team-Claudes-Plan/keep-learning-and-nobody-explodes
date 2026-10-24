import { createBrowserRouter, Navigate } from 'react-router'
import CityPage from './pages/CityPage'
import HousePage from './pages/HousePage'
import StoreyPage from './pages/StoreyPage'
import NotFoundPage from './pages/NotFoundPage'
import MinigamesPage from './pages/MinigamesPage'
import BombPage from './pages/BombPage'
import { KoopBombPage, KoopManualPage, KoopStartPage } from './pages/KoopPages'

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/city" replace /> },
  { path: '/city', element: <CityPage /> },
  { path: '/houses/:houseId', element: <HousePage /> },
  { path: '/houses/:houseId/storeys/:storeyId', element: <StoreyPage /> },
  { path: '/minigames', element: <MinigamesPage /> },
  { path: '/minigames/bomb', element: <BombPage /> },
  { path: '/minigames/modules/:moduleId', element: <BombPage /> },
  { path: '/koop', element: <KoopStartPage /> },
  { path: '/koop/:seed/bombe', element: <KoopBombPage /> },
  { path: '/koop/:seed/handbuch', element: <KoopManualPage /> },
  { path: '*', element: <NotFoundPage /> },
])
