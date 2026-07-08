/** 404 route — friendly blankslate with links back to safety. */
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.jsx';
import { IconAlert } from '../components/Icons.jsx';

export default function NotFound() {
  return (
    <div className="container">
      <EmptyState
        icon={<IconAlert size={32} />}
        title="Page not found"
        description="There's nothing at this URL. Try one of the links below."
        action={
          <div className="row gap-8" style={{ justifyContent: 'center' }}>
            <Link to="/" className="btn primary">Home</Link>
            <Link to="/cohorts/global" className="btn">Global leaderboard</Link>
            <Link to="/join" className="btn">Join</Link>
          </div>
        }
      />
    </div>
  );
}
