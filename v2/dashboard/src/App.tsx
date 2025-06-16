import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import useStore from './store/useStore'
import Layout from './components/Layout'
import OverviewPanel from './components/OverviewPanel'
import ThemeExplorer from './components/ThemeExplorer'
import ThemeDetail from './components/ThemeDetail'
import EntityBrowser from './components/EntityBrowser'
import EntityDetail from './components/EntityDetail'
import CommentBrowser from './components/CommentBrowser'
import CommentDetail from './components/CommentDetail'
import LoadingScreen from './components/LoadingScreen'
import ErrorScreen from './components/ErrorScreen'
import ScrollToTop from './components/ScrollToTop'

function App() {
  const { loading, error, loadData } = useStore()

  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) return <LoadingScreen />
  if (error) return <ErrorScreen error={error} />

  return (
    <HashRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPanel />} />
          <Route path="themes" element={<ThemeExplorer />} />
          <Route path="themes/:themeCode" element={<ThemeDetail />} />
          <Route path="entities" element={<EntityBrowser />} />
          <Route path="entities/:category/:label" element={<EntityDetail />} />
          <Route path="comments" element={<CommentBrowser />} />
          <Route path="comments/:commentId" element={<CommentDetail />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App 