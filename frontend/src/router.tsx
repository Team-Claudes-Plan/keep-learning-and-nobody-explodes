import { Navigate, createBrowserRouter } from 'react-router'
import TitlePage from './pages/TitlePage'
import IslandsPage from './pages/IslandsPage'
import HousePage from './pages/HousePage'
import StoreyPage from './pages/StoreyPage'
import NotFoundPage from './pages/NotFoundPage'
import MinigamesPage from './pages/MinigamesPage'
import BombPage from './pages/BombPage'
import { KoopBombPage, KoopManualPage, KoopStartPage } from './pages/KoopPages'
import { SessionGamePage, SessionLobbyPage } from './pages/SessionPages'
import { USES_BACKEND } from './api/client'
import AppShell from './components/AppShell'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <TitlePage /> },
      { path: '/islands/:islandId?', element: <IslandsPage /> },
      { path: '/islands/:islandId/houses/:topicId', element: <HousePage /> },
      { path: '/islands/:islandId/houses/:topicId/storeys/:storeyId', element: <StoreyPage /> },
      { path: '/city', element: <Navigate to="/islands" replace /> },
      { path: '/minigames', element: <MinigamesPage /> },
      { path: '/minigames/bomb', element: <BombPage /> },
      { path: '/minigames/modules/:moduleId', element: <BombPage /> },
      // With a backend, koop plays over the game session websocket; the seeded koop needs the mocks.
      { path: '/koop', element: USES_BACKEND ? <SessionLobbyPage /> : <KoopStartPage /> },
      { path: '/koop/spiel/:gameId', element: <SessionGamePage /> },
      { path: '/koop/:seed/bombe', element: <KoopBombPage /> },
      { path: '/koop/:seed/handbuch', element: <KoopManualPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
