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

The GM can override any token's Health, Stagger Resist, Light and Sanity, move any token, add or remove enemies, and keep notes only the GM sees.

### How it's built

Everything runs on Firebase:

| Piece | Firebase product | Where |
|---|---|---|
| Website | Hosting | `src/` (React + Vite) |
| Accounts | Authentication (email/password) | `src/screens/Auth.tsx` |
| Games and the live table | Firestore; every screen listens for changes in real time | `shared/types.ts` lists the layout |
| Game actions (the "referee") | Cloud Functions; every change to a table is checked and applied here | `functions/src/index.ts` |
| Who can read what | Security rules | `firestore.rules`, `storage.rules` |
| Uploaded maps and art | Cloud Storage (rules ready; upload screens coming) | `storage.rules` |

Clients can only read; games and tables are changed only by the Cloud Functions, so a player can't edit their own HP from the browser console.

### Run locally

Needs Node 22 and Java 21+ (for the Firebase emulators).

```sh
npm install          # also installs the Cloud Functions' packages
npm run dev
```

This starts the Firebase emulators (a local copy of Auth, Firestore, Functions and Storage) and the site at http://localhost:5173. The emulator dashboard at http://localhost:4000 shows accounts and data. Emulator data is wiped when you stop it.

Phones and iPads on the same Wi-Fi can open `http://<laptop-ip>:5173`. This doubles as the **offline fallback** at the venue: it needs no internet once installed, but accounts there are separate from the hosted site.

Security rules tests: `npm run test:rules`.

### Deploy to Firebase

One-time setup in the [Firebase console](https://console.firebase.google.com):

1. Create a project and switch it to the **Blaze** plan (needed for Cloud Functions; your Google credits cover usage).
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Firestore Database:** create a database (production mode).
4. **Storage:** create the default bucket.
5. **Project settings → Your apps:** add a **Web app** (no need to copy the config; Hosting serves it to the site automatically).

Then from this folder:

```sh
npx firebase login
npx firebase use --add        # pick your project
npm run deploy
```

On the first deploy the CLI asks to let Storage rules read Firestore (used to check who's in a game); answer yes. The site is then live at `https://<project-id>.web.app`. A custom domain can be added under **Hosting** in the console.
