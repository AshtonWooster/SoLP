import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import type { ClientToServer, ServerToClient } from "../shared/types.ts";
import { authRouter, loadUser } from "./auth.ts";
import { initDb } from "./db.ts";
import { gamesRouter } from "./games.ts";
import { attachLive, flushAll } from "./live.ts";

const PORT = Number(process.env.PORT ?? 3001);

await initDb();

const app = express();
app.set("trust proxy", 1); // hosts terminate HTTPS in front of the app
app.use(express.json({ limit: "100kb" }));
app.use(loadUser);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});
app.use("/api/auth", authRouter);
app.use("/api/games", gamesRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

// In production the server also hosts the built website, so one deploy covers everything.
const distDir = path.resolve(import.meta.dirname, "../dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // Any other page gets the app; the app picks the screen from the URL.
  app.use((_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  // Live connections carry the login cookie, so only accept them from this site's own pages.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    let sameSite = !origin;
    try {
      sameSite ||= new URL(origin!).host === req.headers.host;
    } catch {}
    callback(null, sameSite);
  },
});
attachLive(io);

http.listen(PORT, "0.0.0.0", () => {
  console.log(`SoLP server listening on port ${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) console.log(`  LAN: http://${a.address}:${PORT}`);
    }
  }
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    await flushAll();
    process.exit(0);
  });
}
