import { Routes, Route } from 'react-router-dom'
import { ListenLaterProvider } from '@/hooks/useListenLater'
import { Layout } from '@/components/Layout'
import Home from '@/pages/Home'
import Login from '@/pages/Login'
import Onboarding from '@/pages/Onboarding'
import AlbumDetail from '@/pages/AlbumDetail'
import Artist from '@/pages/Artist'
import Profile from '@/pages/Profile'
import SearchPage from '@/pages/Search'
import Rankings from '@/pages/Rankings'
import RankingDetail from '@/pages/RankingDetail'
import Activity from '@/pages/Activity'
import Genre from '@/pages/Genre'
import Lists from '@/pages/Lists'
import ListDetail from '@/pages/ListDetail'
import ListenLater from '@/pages/ListenLater'
import Friends from '@/pages/Friends'
import Wrapped from '@/pages/Wrapped'
import Privacy from '@/pages/Privacy'
import Terms from '@/pages/Terms'

import Settings from '@/pages/Settings'
import HelpFeedback from '@/pages/HelpFeedback'
import Notifications from '@/pages/Notifications'

export default function App() {
  return (
    <ListenLaterProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/album/:id" element={<AlbumDetail />} />
          <Route path="/artist/:id" element={<Artist />} />
          <Route path="/profile/:id" element={<Profile />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/rankings/build" element={<RankingDetail />} />
          <Route path="/rankings/:id" element={<RankingDetail />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/genre/:id" element={<Genre />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:id" element={<ListDetail />} />
          <Route path="/listen-later" element={<ListenLater />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/wrapped" element={<Wrapped />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/help" element={<HelpFeedback />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    </ListenLaterProvider>
  )
}
