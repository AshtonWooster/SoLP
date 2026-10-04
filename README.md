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

**During play, the GM's browser is the game server.** When the GM opens "Run the game", that tab holds the live table. The board and every player's phone connect straight to it over WebRTC (the peer-to-peer tech video calls use), which works across the internet, not just on the same Wi-Fi. Moving tokens, changing health and adding enemies go device-to-device, with no Cloud Function call and no database write per action.

Firebase handles everything around that:

| Piece | Firebase product | Where |
|---|---|---|
| Website | Hosting | `src/` (React + Vite) |
| Accounts | Authentication (email/password) | `src/screens/Auth.tsx` |
| Games list, saved tables | Firestore | `shared/types.ts` lists the layout |
| Helping devices find the GM | Firestore (a few writes per connection) | `src/net/` |
| Creating and joining games | Cloud Functions (once per game, not during play) | `functions/src/index.ts` |
| Game rules | Run in the GM's browser | `shared/engine.ts` |
| Who can read what | Security rules | `firestore.rules`, `storage.rules` |
| Uploaded maps and art | Cloud Storage (rules ready; upload screens coming) | `storage.rules` |

The GM tab saves the table to Firestore a few seconds after changes and when it closes, so the next session picks up where you left off. Players can't change anything themselves: their actions go to the GM's tab, which checks them against the rules first.

Keep the GM screen open during play. If it closes, phones and the board show "Waiting for the GM" and reconnect automatically when it's opened again. Opening the GM screen on another device moves hosting there.

### Characters

Each player makes one character per game from the game page ("Create my character"), following the six steps in Act 5 of the ruleset: Rank, Stats, Proficiencies, Augment, Weapons and Armor (with Passives, Pages and Dice), and Finishing Touches. Edits save automatically, and a checklist shows what's left. Party members can view each other's sheets; only the owner and the GM can edit, and only the GM can change Rank. At the table, a player's token takes its name and max Health, Stagger Resist, Sanity and Light from their character, and follows edits live.

The ruleset's tables aren't written yet, so the numbers they'd provide (points per Rank, base Resources, max Passive Costs) are **placeholders in `shared/ruleset.ts`**. Fill them in there and the whole app follows.

### Players who can't connect

Most networks allow direct connections. Some (many phone carriers, strict school or office Wi-Fi) block them; those players get stuck on "Reconnecting…". They need a **TURN relay**, which forwards their traffic. Firebase doesn't offer one. Options:

- **Run your own on Google Cloud** (uses your credits): a small Compute Engine VM running [coturn](https://github.com/coturn/coturn), with UDP 3478 and TCP 443/5349 open.
- **A hosted TURN service** such as Cloudflare Realtime TURN or Metered; several have free tiers (check current limits).

Put its details in a `.env` file (see `.env.example`) and redeploy. TURN settings in `.env` end up in the website's code, so use credentials you're fine rotating.

### Run locally

Needs Node 22 and Java 21+ (for the Firebase emulators).

```sh
npm install          # also installs the Cloud Functions' packages
npm run dev
```

This starts the Firebase emulators (a local copy of Auth, Firestore, Functions and Storage) and the site at http://localhost:5173. Open the GM screen in one tab and the board or a player in another (use a private window for a second account). The emulator dashboard at http://localhost:4000 shows accounts and data. Emulator data is wiped when you stop it.

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
