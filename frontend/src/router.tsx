import { createBrowserRouter, Navigate } from 'react-router'
import CityPage from './pages/CityPage'
import HousePage from './pages/HousePage'
import StoreyPage from './pages/StoreyPage'
import NotFoundPage from './pages/NotFoundPage'

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/city" replace /> },
  { path: '/city', element: <CityPage /> },
  { path: '/houses/:houseId', element: <HousePage /> },
  { path: '/houses/:houseId/storeys/:storeyId', element: <StoreyPage /> },
  { path: '*', element: <NotFoundPage /> },
])
