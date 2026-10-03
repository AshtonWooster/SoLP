import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { friendlyError, joinGameFn } from "../firebase.ts";

/** Invite link / QR code target. Joining adds you to the game permanently. */
export function Join() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    joinGameFn({ code })
      .then(({ data }) => navigate(`/games/${data.id}`, { replace: true }))
      .catch((err) => setError(friendlyError(err)));
  }, [code, navigate]);
  return (
    <main className="center">
      {error ? (
        <>
          <p className="error">{error}</p>
          <Link to="/">Back to your games</Link>
        </>
      ) : (
        <p className="muted">Joining…</p>
      )}
    </main>
  );
}
