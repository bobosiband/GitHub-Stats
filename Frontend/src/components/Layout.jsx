/**
 * Site chrome: sticky header with brand, top-level nav, member-search box,
 * and the theme toggle — plus the footer. Wraps every routed page via
 * <Outlet/>. Theme changes are persisted to localStorage.
 */

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  IconMarkGithub,
  IconMoon,
  IconSearch,
  IconSun,
} from './Icons.jsx';

/** Read the current theme from the boot script's dataset. */
function initialTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export default function Layout() {
  const [theme, setTheme] = useState(initialTheme);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('gitrank-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const onSearch = (e) => {
    e.preventDefault();
    const q = query.trim().replace(/^@/, '');
    if (q) navigate(`/u/${encodeURIComponent(q)}`);
  };

  return (
    <div className="app">
      <header className="header" role="banner">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="GitRank home">
            <span className="brand-mark"><IconMarkGithub size={20} /></span>
            GitRank
          </Link>
          <nav className="nav" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Home
            </NavLink>
            <NavLink to="/cohorts/global" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Global
            </NavLink>
            <NavLink to="/compare" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Compare
            </NavLink>
            <NavLink to="/join" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Join
            </NavLink>
          </nav>
          <div className="header-spacer" />
          <div className="header-tools">
            <form className="search" role="search" onSubmit={onSearch}>
              <span className="search-icon" aria-hidden="true"><IconSearch size={14} /></span>
              <input
                type="search"
                aria-label="Look up a member by GitHub username"
                placeholder="Find a member…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
              <span className="text-sm">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="footer">
        <div>
          Public, read-only view of GitHub activity. Snapshots are refreshed on a schedule —
          numbers reflect the most recent sync.
        </div>
      </footer>
    </div>
  );
}
