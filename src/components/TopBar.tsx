import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { useAuth } from "../api.ts";
import { auth } from "../firebase.ts";

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
              await signOut(auth);
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
