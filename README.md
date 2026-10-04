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
| Board | Anyone in the game | iPad / TV / any screen | `/games/:id/board` |
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

The ruleset's tables aren't written yet, so the numbers they'd provide (points per Rank, base Resources, max Passive Costs, base Movement) are **placeholders in `shared/ruleset.ts`**. Fill them in there and the whole app follows.

### Inventory and decks

The character sheet has **Inventory** and **Decks** tabs (Acts 6 and 7):

- **Inventory:** 9 Slots (the GM can change the count), each holding an Item or a Tool. Stacking items hold several in one Slot up to a max. Tools carry a Page. The **Trinket Slot** holds one Trinket, which is always active while equipped.
- **Combat Deck:** 12 Pages built from your Equipment: any number of copies of Basic Pages, one of each Special Page.
- **Auxiliary Deck:** built automatically from your Inventory's Tools (one copy per item in a stack). The equipped Trinket isn't a card; it's always on.

Players can edit decks any time outside combat; during combat they're locked (also enforced in the security rules). The GM can see and edit every player's inventory and decks, from the game page or the token panel on the GM screen. The phone's table view shows both decks, the Trinket and the Inventory.

### Combat

From the GM screen, **Start combat**, tick who's in the fight, and **Roll Speed and start**. Everyone rolls 1d6 + Justice and acts from highest to lowest (Act 8). On a tie, players go before enemies; the GM can swap neighbours with ↑/↓ to settle any other tie.

At the start of each turn the active character gets Movement Points (3 + Justice; the base is a placeholder in `shared/ruleset.ts`) and Upkeep restores 1 Light. On a player's turn their token glows on the board: they tap it, reachable tiles light up, and they tap one to move. They can also move with the phone's arrows, and end their turn from the board or their phone. Players can only move on their own turn during combat.

The GM can move and edit anything at any time, press **Next turn** (e.g. after an enemy's turn), add or remove combatants, re-roll Speed, and **End combat**. Enemies' Justice is set in the GM's token panel; players' comes from their character sheet.

**Turn phases** follow Act 8 exactly and pass on their own when nothing is needed from the player: **Resolve Slotted Pages** → **Upkeep** (draw 1 Page, +1 Light; Counter Dice expire) → **Combat Actions** (waits for the player) → **Endstep** → next character. The phase logic is in `shared/combat.ts` (`runPhases`), ready for Effects and Passives to hook into later.

**Pages in combat** (Act 3):
- Players start combat with 3 Pages from their shuffled Combat Deck and draw 1 each Upkeep; an empty deck reshuffles the discard pile. The Auxiliary Deck is available from the start; a used Auxiliary Page is gone until combat ends. Hands are visible to the party; draw piles are hidden.
- On your turn, pick a Page on your phone; valid targets (within Weapon Range) light up on the board. Tap one on the board or phone to pay its Light and slot it on a Speed Die. It resolves at the start of your next turn.
- Slotting against a Speed Die that already holds a Page starts a **Clash**, shown as an orange arrow. Dice clash top to bottom: higher Final Power wins, ties are Draws, Clash Win/Lose give ±1 Sanity. Block and Evade, Recycling, Melee vs Ranged, leftover dice, and Counter Dice all work as written. **Mass Attacks** (Summation and Individual) and **Instant** Pages are in too.
- Damage uses the target's Type Resistance (players' from their Armor; the GM sets enemies'). Health 0 = Knocked Out (turns skipped), Stagger 0 = Staggered, Sanity at its minimum = Panic. A character targeted by an enemy's non-Mass Page can't move. **Dash** turns Light into Movement.
- Enemies don't have decks yet: the GM gives each enemy a list of Pages in its token panel and uses them on its turn.
- Placeholders (not in the ruleset yet) are in `shared/ruleset.ts`: 1 Speed Die each, Weapon Range (Melee 1, Ranged 6, Mass 3), Dash (1 Light → 2 Movement).

Anyone in the game can open the board, not just the GM.

`npm run test:engine` runs the rules tests (combat, decks, clashes).

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
