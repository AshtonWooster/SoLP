MuleHacks 2026 Project

Ruleset: https://github.com/AshtonWooster/LoR_PMTTRPG

Ashton Wooster
Tyler Ruf

## SoLP: a digital table for the LoR PMTTRPG

Everyone has one kind of account. Creating a game makes you its GM; joining one with an invite code (or the QR code on the board) adds you to it as a player permanently, and it shows up on your front page whenever you log in.

| Screen | Who | Device | URL |
|---|---|---|---|
| Front page | Everyone | Any | `/` |
| Game page | Members | Any | `/games/:id` |
| GM controls | GM | Laptop | `/games/:id/gm` |
| Board | GM (logged in on the table screen) | iPad / TV | `/games/:id/board` |
| Player view | Players | Phone | `/games/:id/play` |

The GM can override any token's Health, Stagger Resist, Light and Sanity, move any token, add or remove enemies, and keep notes only the GM sees. Each game's table is saved to the database, so it survives restarts.

### Run locally

```sh
npm install
npm run dev
```

Open http://localhost:5173. With no `DATABASE_URL` set, data is kept in an embedded Postgres under `./data`, so there's nothing else to install. Phones and iPads on the same Wi-Fi can open `http://<laptop-ip>:5173`.

### LAN fallback (no internet at the venue)

```sh
npm run build
npm start
```

The server prints its LAN address, e.g. `http://192.168.1.20:3001`. Connect every device to the same Wi-Fi or a phone hotspot and open that address. Accounts made on the hosted site don't exist on the laptop copy (it has its own database), so sign up again there.

### Deploy (Railway)

1. On railway.com, create a project with **Deploy from GitHub repo** and pick this repository.
2. In the same project, add a **PostgreSQL** database.
3. On the app service, add the variable `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
4. Under the app's **Settings → Networking**, generate a domain (or attach your own).

`railway.json` sets the build, start command and health check. Every push to the deployed branch redeploys.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Unset = embedded database in `./data`. |
| `DATABASE_SSL` | Set to `true` if your Postgres requires SSL from outside its network. |
| `PORT` | Set by the host. Defaults to 3001. |
