import { Navigate, createBrowserRouter } from 'react-router'
import TitlePage from './pages/TitlePage'
import IslandsPage from './pages/IslandsPage'
import HousePage from './pages/HousePage'
import StoreyPage from './pages/StoreyPage'
import NotFoundPage from './pages/NotFoundPage'
import MinigamesPage from './pages/MinigamesPage'
import BombPage from './pages/BombPage'
import SoundTestPage from './pages/SoundTestPage'
import { KoopBombPage, KoopManualPage, KoopStartPage } from './pages/KoopPages'

export const router = createBrowserRouter([
  { path: '/', element: <TitlePage /> },
  { path: '/islands/:islandId?', element: <IslandsPage /> },
  { path: '/islands/:islandId/houses/:houseId', element: <HousePage /> },
  { path: '/islands/:islandId/houses/:houseId/storeys/:storeyId', element: <StoreyPage /> },
  { path: '/city', element: <Navigate to="/islands" replace /> },
  { path: '/minigames', element: <MinigamesPage /> },
  { path: '/minigames/bomb', element: <BombPage /> },
  { path: '/minigames/modules/:moduleId', element: <BombPage /> },
  { path: '/soundtest', element: <SoundTestPage /> },
  { path: '/koop', element: <KoopStartPage /> },
  { path: '/koop/:seed/bombe', element: <KoopBombPage /> },
  { path: '/koop/:seed/handbuch', element: <KoopManualPage /> },
  { path: '*', element: <NotFoundPage /> },
])
