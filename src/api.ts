import { createContext, useContext, useEffect, useState } from "react";
import { doc, onSnapshot, type DocumentData } from "firebase/firestore";
import type { User } from "../shared/types.ts";
import { db, friendlyError } from "./firebase.ts";

export interface AuthContextValue {
  /** undefined while Firebase is still restoring the session. */
  user: User | null | undefined;
  setUser: (u: User | null) => void;
}

export const AuthContext = createContext<AuthContextValue>({ user: undefined, setUser: () => {} });

export const useAuth = () => useContext(AuthContext);

export interface Live<T> {
  data: T | undefined;
  error: string;
  loading: boolean;
  /** True while showing saved data because the connection to Firebase is down. */
  offline: boolean;
}

/** Subscribes to one Firestore document; re-renders whenever anyone changes it. Pass null to skip. */
export function useDoc<T = DocumentData>(path: string | null): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: undefined, error: "", loading: !!path, offline: false });
  useEffect(() => {
    if (!path) return setState({ data: undefined, error: "", loading: false, offline: false });
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      doc(db, path),
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.exists() ? (snap.data() as T) : undefined,
          error: "",
          loading: false,
          offline: snap.metadata.fromCache,
        }),
      (err) =>
        setState({
          data: undefined,
          error: err.code === "permission-denied" ? "You don't have access to this." : friendlyError(err),
          loading: false,
          offline: false,
        }),
    );
  }, [path]);
  return state;
}
