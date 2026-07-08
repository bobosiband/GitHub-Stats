/**
 * Route table. Uses HashRouter so the built app works from any GitHub Pages
 * path (project, user, or custom domain) with no 404-rewrite hack, and deep
 * links survive a refresh.
 */
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Cohort from './pages/Cohort.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Titles from './pages/Titles.jsx';
import Analytics from './pages/Analytics.jsx';
import Profile from './pages/Profile.jsx';
import Join from './pages/Join.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="cohorts" element={<Navigate to="/" replace />} />
          <Route path="cohorts/:slug" element={<Cohort />}>
            <Route index element={<Leaderboard />} />
            <Route path="titles" element={<Titles />} />
            <Route path="analytics" element={<Analytics />} />
          </Route>
          <Route path="u/:username" element={<Profile />} />
          <Route path="join" element={<Join />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
