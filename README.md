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

**Weapons and Armor** (step 5) work like a card editor: the selected Page sits on the left as a Library of Ruina-style card you type on directly (cost, name, type, each die's type, range and effect, the Page effect); tap its art to upload an image. On the right, each weapon and armor shows its Passives and its Pages as small cards: tap one to edit it, or **+** to add a Page. The big **+** at the bottom adds a blank weapon or armor, which opens on the left as its own card: name, its own **Rank** (which sets its max Passive Cost; the Max Costs table is a placeholder in `shared/ruleset.ts` until the ruleset fills it in), hands or resistances, description, and Passives added one at a time (name, cost, description). Negative Passives can add up to the same max. Tap a weapon or armor on the right to edit it again. A die's range (e.g. 2-7) sets its size and Base Power (1d6+1). E.G.O. Pages, Tools and enemy Pages use the same card editor.

The character sheet has **Inventory** and **Decks** tabs (Acts 6 and 7):

- **Inventory:** 9 Slots (the GM can change the count), each holding an Item or a Tool. Stacking items hold several in one Slot up to a max. Tools carry a Page. The **Trinket Slot** holds one Trinket, which is always active while equipped.
- **Combat Deck:** 12 Pages built from your Equipment: any number of copies of Basic Pages, one of each Special Page.
- **Auxiliary Deck:** built automatically from your Inventory's Tools (one copy per item in a stack). The equipped Trinket isn't a card; it's always on.

Players can edit decks any time outside combat; during combat they're locked (also enforced in the security rules). The GM can see and edit every player's inventory and decks, from the game page or the token panel on the GM screen. The phone links to the deck editor while you're out of combat.

### Combat

From the GM screen, **Start combat**, tick who's in the fight, and **Roll Speed and start**. Everyone rolls 1d6 + Justice and acts from highest to lowest (Act 8). On a tie, players go before enemies; the GM can swap neighbours with ↑/↓ to settle any other tie.

At the start of each turn the active character gets Movement Points (3 + Justice; the base is a placeholder in `shared/ruleset.ts`) and Upkeep restores 1 Light. On a player's turn their token glows on the board: they tap it, reachable tiles light up, and they tap one to move. They end their turn from the board or their phone. Players can only move on their own turn during combat. Outside combat, anyone can tap their own token on the board and then a tile to move it.

The GM can move and edit anything at any time, press **Next turn** (e.g. after an enemy's turn), add or remove combatants, re-roll Speed, and **End combat**. Enemies' Justice is set in the GM's token panel; players' comes from their character sheet.

**Turn phases** follow Act 8 exactly and pass on their own when nothing is needed from the player: **Resolve Slotted Pages** → **Upkeep** (draw 1 Page, +1 Light; Counter Dice expire) → **Combat Actions** (waits for the player) → **Endstep** → next character. The phase logic is in `shared/combat.ts` (`runPhases`), ready for Effects and Passives to hook into later.

**Pages in combat** (Act 3):
- Players start combat with 3 Pages from their shuffled Combat Deck and draw 1 each Upkeep; an empty deck reshuffles the discard pile. The Auxiliary Deck is available from the start; a used Auxiliary Page is gone until combat ends. Hands are visible to the party; draw piles are hidden.
- On your turn, pick a Page on your phone; valid targets (within Weapon Range) light up on the board. Tap one on the board or phone to pay its Light and slot it on a Speed Die. It resolves at the start of your next turn.
- **E.G.O. Pages** are made on the character sheet (Decks tab). They aren't in the Combat Deck: each one can be used once per combat from the phone's E.G.O. category.
- Slotting against a Speed Die that already holds a Page starts a **Clash**, shown as one orange arrow with a head at each end. If that Page was aimed at someone else, it's **redirected** to whoever clashed with it. Dice clash top to bottom: higher Final Power wins, ties are Draws, Clash Win/Lose give ±1 Sanity. Block and Evade, Recycling, Melee vs Ranged, leftover dice, and Counter Dice all work as written. **Mass Attacks** (Summation and Individual) and **Instant** Pages are in too.
- Offensive dice deal damage × the target's Type Resistance, and the same amount × their Stagger Resistance as Stagger damage. Armor has both sets; the GM sets enemies'. Health 0 = Knocked Out (turns skipped), Sanity at its minimum = Panic. Stagger 0 = **Staggered**: the character's slotted Pages and Counter Dice are discarded, they can't act, and all their Resistances (damage and Stagger) are 2x. They recover at the second Upkeep they pass while Staggered, with full Stagger Resist, and act that turn. Staggered during their own Resolve step, that turn's Upkeep counts as the first. (Not in the ruleset yet: the 2 Upkeeps and 2x are in `shared/ruleset.ts`.) A character targeted by an enemy's non-Mass Page can't move. **Dash** turns Light into Movement.
- Enemies have decks too: they draw 3 to start and 1 each Upkeep, and the GM plays their hand from the GM screen. Enemy hands are hidden from players.
- Placeholders (not in the ruleset yet) are in `shared/ruleset.ts`: 1 Speed Die each, Weapon Range (Melee 1, Ranged 6, Mass 3), Dash (1 Light → 2 Movement).

Anyone in the game can open the board, not just the GM.

When Pages resolve, the board and the GM's map animate it above the characters: the Page names appear, each pair of dice rolls, shows its Final Power, and the winner grows while the loser shatters (Draws grey out), then the next pair. One-Sided hits show the die and an impact on the target. The full detail stays in the log. Health, Stagger and Sanity change on the board, GM map and phones when each die's result plays, not before (the log shows results straight away). Tokens slide to their new tile when they move.

### The player screen

The phone shows one screen with three parts, so players never have to leave it during combat:

- **Top:** portrait, name, and Health (red), Stagger (yellow), Sanity (blue) and Light (orange). Buttons for **Speed dice** (pick which die the next Page goes on), **End turn** (asks first if a die is still free and a Page is affordable), **Dash**, and **Story roll**. **Cycle characters** shows anyone else's Speed Dice, the Page on each, its targets and the Page answering it. **Effects** lists your Effects: count, name, description and duration.
- **Middle:** a carousel (‹ ›) of Inventory · Stats, Weapons · Armor, Augments · Proficiencies. Tapping one opens it in place; ✕ goes back. Stats have **+** buttons while points are left. Items can be used from Inventory.
- **Bottom:** the Pages in your hand, switched between **Combat**, **E.G.O.** and **Auxiliary** (each keeps its own selection). Tapping a Page enlarges it, Library of Ruina style: the card (cost, type, name, art, dice) on the left and each die's Power range and effects on the right. **Select this Page** picks it. A strip shows the die, Page, target and whether that's valid. Once a die, a target and a Page are chosen, the Page is placed. Mass Attacks take several targets, then **Use**.

Opening panels and popups never clears the selection, ends the turn or changes the category.

**Story Rolls** roll 1d20 + a Stat and post the result to the table log (the d20 is a placeholder in `shared/ruleset.ts`; enemies roll with Justice).

**Dice effects:** each die on a Page can have its own effect text (e.g. "On Hit: Inflict 1 Fragile next Scene"), shown next to it when the Page is enlarged. Effects are text for now; they don't trigger automatically.

**Portraits and Page art:** players upload a portrait on their sheet (Finishing Touches) and 4:3 landscape art on each Page. The GM uploads enemy portraits and Page art in the templates. Images are under 5 MB and stored in Firebase Storage. Portraits show on tokens.

**Effects** are set by the GM in the token panel on the GM screen (name, count, description, duration) for now; they're shown to players but don't trigger anything automatically yet.

### Maps

On the GM screen, **Maps** lists the game's maps (like Roll20 pages or Foundry scenes). The GM can rename the current map, change its size (4–60 tiles each way) and upload a background image, which is stretched over the grid. **+ Create map** adds a new one; **Switch** puts it on the table for everyone.

Player characters come along when the map changes, keeping their Health, Light, Effects and everything else. Each map remembers where they stood, so switching back puts them where they were (the first visit lines them up at the top-left). Enemies and other tokens stay on the map they were placed on, with their own Health and decks, until the GM switches back. Maps can't be switched during combat. Players only receive the current map; the others (and the enemies waiting on them) stay with the GM.

### Enemy templates

On the game page, **Enemy templates** (GM only) lets the GM design enemies: Health, Stagger Resist, Light, Sanity, Justice, damage and Stagger resistances, notes, and a Combat Deck of Pages with any number of copies (no size limit). On the GM screen, **Place** puts a copy on the map. Each copy is its own token ("Thug", "Thug 2", ...) with its own Health, deck and so on; removing the token removes only that copy. Editing a placed enemy (token panel → Pages and deck) doesn't change its template.

### Usable items

The GM can mark any inventory item **Usable**, and usable items **Consumable** with a number of uses. Players tap **Use** on their sheet or phone; when a consumable's uses run out, one item of the stack is used up (or the item is gone). Tools are used through the Auxiliary Deck in combat and count down the same way when consumable.

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
