/** Layout — persistent header/footer around routed content. Filled in Phase 3. */
import { Outlet } from 'react-router-dom';
export default function Layout() {
  return (
    <div className="app">
      <Outlet />
    </div>
  );
}
