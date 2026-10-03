MuleHacks 2026 Project

Ruleset: https://github.com/AshtonWooster/LoR_PMTTRPG

Ashton Wooster
Tyler Ruf

## SoLP: a digital table for the LoR PMTTRPG

One server runs the game. Every device is a live view of it:

| Screen | Device | URL |
|---|---|---|
| Game Master | Laptop | `/gm` |
| Game Board | iPad | `/board?room=CODE` |
| Player | Phone | `/play?room=CODE` (scan the QR code on the board) |

The GM can override any token's Health, Stagger Resist, Light and Sanity, move any token, add or remove enemies, and keep notes that only the GM sees.

### Run locally

```sh
npm install
npm run dev
```

This opens the site at http://localhost:5173. The dev server also listens on your local network, so phones and iPads on the same Wi-Fi can open `http://<laptop-ip>:5173`.

### LAN fallback (no internet at the venue)

```sh
npm run build
npm start
```

The server prints its LAN address, e.g. `http://192.168.1.20:3001`. Connect every device to the same Wi-Fi or a phone hotspot and open that address.

### Deploy (Render)

1. On render.com, choose **New → Blueprint** and pick this repository. `render.yaml` sets up everything else.
2. Every push to the deployed branch redeploys automatically.

Games are stored in server memory for now, so restarting the server (or the free tier sleeping after inactivity) clears open rooms. Open the site a few minutes before a demo.
