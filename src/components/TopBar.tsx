import { Link, useNavigate } from "react-router-dom";
import { api, useAuth } from "../api.ts";

export function TopBar() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <Link to="/" className="brand">SoLP</Link>
      {user && (
        <span className="topbar-user">
          {user.displayName}
          <button
            className="link"
            onClick={async () => {
              await api("/auth/logout", {});
              setUser(null);
              navigate("/");
            }}
          >
            Log out
          </button>
        </span>
      )}
    </header>
  );
}
