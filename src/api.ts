import { createContext, useContext } from "react";
import type { User } from "../shared/types.ts";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** JSON request to the server's /api. Throws ApiError with the server's message on failure. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface AuthContextValue {
  /** undefined while the session is still being checked. */
  user: User | null | undefined;
  setUser: (u: User | null) => void;
}

export const AuthContext = createContext<AuthContextValue>({ user: undefined, setUser: () => {} });

export const useAuth = () => useContext(AuthContext);
