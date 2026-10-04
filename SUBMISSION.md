# SoLP: A virtual tabletop platform
**Ashton Wooster** & **Tyler Ruf**   
**Try it out:** https://solp.online

**Theme: Connections.** SoLP brings a tabletop RPG night online, so a group of friends can play together from anywhere in the world. The GM runs the table from their own browser and players join from their phones, wherever they are. They all share one live battle map, see each other's turns play out, and stay in the same fight even when they're on different continents. The connection between players runs straight from device to device.

SoLP is built for the **LoR PMTTRPG**, a fan-made tabletop RPG inspired by *Library of Ruina*. Combat is built around slotting Pages (cards) onto Speed Dice and resolving them in dice Clashes. Tracking all of that on paper is slow; SoLP runs the rules for you.

---

## Who is the target user for your project?

**The problem:** tabletop groups today are stuck choosing between two options.
- **Physical boards** are interactive but expensive to build up, and they only work when everyone is in the same room. They can't connect friends across the world.
- **Online tabletops** like Roll20 and Foundry connect people anywhere, but they cost money and don't support custom rule systems like this one, so players still track combat by hand.

**SoLP is the bridge between the two.** A live board screen (an iPad or TV) shows the table like a real game board. Each player's phone works as their personal "remote": they pick Pages, aim at targets and watch them light up on the board. It's as interactive as playing in person, whether everyone is in one room or on different continents, with the system's own rules built in.

It's for:
- **Game Masters** who want to run the LoR PMTTRPG for a group, in person or online. A typical setup is a laptop for GM controls and an iPad or TV showing the shared board.
- **Players** who join from their phones. They don't need an app install or a laptop; they just open a link or scan the QR code on the board.
- **Groups spread across cities or countries** who still want a proper tabletop night together.

## GitHub / repository link

- App: https://github.com/AshtonWooster/SoLP
- The ruleset it implements: https://github.com/AshtonWooster/LoR_PMTTRPG

## What are the main features of your project?

**Accounts and games**
- Sign up once. Anyone can create a game and become its GM, or join a game with an invite code or QR code and stay a member permanently.
- Three views of one live table:
  - **GM screen** (laptop): full control.
  - **Board** (iPad/TV): the shared map.
  - **Player screen** (phone): your character, built for combat.

**Characters, built from the rulebook**
- Guided character creation following the ruleset's six steps: Rank, Stats, Proficiencies, Augment, Weapons and Armor, and Finishing Touches. A live checklist shows what's left.
- A card-style editor for Pages. You type the cost, name, dice ranges and effects right on a *Library of Ruina*-style card, and tap the art to upload an image.
- Weapons and Armor each have their own Rank and Passives, with Passive Cost and Negative Passive limits checked as you go.
- Inventory with a Trinket Slot, usable and consumable items, and two decks: a 12-Page Combat Deck and an Auxiliary Deck built from your Tools.
- Character portraits that appear on your token.

**Combat that runs the rules for you**
- Speed rolls and turn order, then the rulebook's turn phases. Phases that need no input pass on their own.
- Players draw a hand and slot Pages on their Speed Dice. Valid targets light up on the shared board.
- Clashes resolve automatically, including:
  - Block, Evade and Counter Dice, and Recycling.
  - Melee vs. Ranged.
  - Mass Attacks (Summation and Individual) and Instant Pages.
  - Damage and Stagger with Resistances.
  - Staggered (2x Resistances, can't act, recover after two Upkeeps) and Knocked Out.
- Clashes play out on the board die by die, like *Library of Ruina*: the dice roll, settle, and the winner glows while the loser shatters. Damage lands only when its die plays.
- Redirected Clashes are drawn as two-way arrows, and tokens slide smoothly when they move.

**A player screen made for the moment**
- One persistent screen for combat:
  - Resources, plus Speed Dice, End Turn, Dash and Story Roll.
  - Your hand as cards; tap one to see the full Page breakdown.
  - Pick a die, a target and a Page to slot it, with clear feedback when something isn't allowed.
- See every other character's Speed Dice, slotted Pages, targets and responses. See your Effects at a glance.

**GM tools**
- Override anything at any time: Health, Stagger, positions, turn order, Effects, and ending combat.
- Enemy templates with their own decks, placed as independent copies.
- Multiple maps with custom background images. Switch between them like Roll20 pages: player characters come along and every map remembers where everyone stood.

## What technology stack did you use?

- **Frontend:** React 19 + TypeScript, Vite, React Router.
- **Real-time play:** WebRTC data channels, the peer-to-peer technology behind video calls. The GM's browser hosts the game.
- **Google Firebase:**
  - **Hosting** for the site.
  - **Authentication** for accounts.
  - **Firestore** for characters, templates and saved tables, and for the WebRTC connection handshake.
  - **Cloud Storage** for portraits, Page art and map backgrounds.
  - **Cloud Functions** for exactly two things: creating a game and joining one by invite code.
- **Shared rules engine:** the same TypeScript rules code runs on every device.
- **Security:** Firestore and Storage security rules, tested against the Firebase emulators.
- **Testing:**
  - Node's test runner for the rules engine (54 tests).
  - `@firebase/rules-unit-testing` for the security rules (13 tests).
  - Playwright end-to-end tests that drive real browsers: GM, board and phones in one game at once.

## What was the most interesting or technically challenging part your team built?

**Getting usage costs under control by moving gameplay peer-to-peer.**

The first version ran every table action through the cloud: moving a token, changing Health, slotting a Page. Each one called a Cloud Function, wrote to Firestore, and fanned out to every connected device. That worked in testing, but our usage numbers grew fast: a single combat has hundreds of small actions, multiplied by every player in the game. For a hackathon project running on credits, that cost would only grow with every group that played.

So we redesigned the architecture around the idea of the theme: **connect the players to each other directly instead of through a server.**

- **The GM's browser became the game server.** It holds the live table and runs the rules engine, so every player action is checked against the rules there before it applies.
- **Phones and the board connect to the GM over WebRTC data channels,** the same peer-to-peer technology video-conferencing apps use. It works across the internet, not just on the same Wi-Fi: STUN servers help devices find each other through home routers.
- **Firestore is only the "introduction".** A device writes its connection offer to a Firestore document, the GM's tab answers, and from then on all traffic goes device-to-device. Firestore otherwise only receives a debounced autosave every few seconds, so the next session picks up where you left off.
- **Cloud Functions dropped to two calls per player, ever:** creating a game and joining one.

This created new problems to solve:
- **Hidden information.** The host sends each device only what it may see: draw piles keep their size but not their order, enemy hands stay hidden, and the GM's other maps (with their waiting enemies) never reach players.
- **Robust connections.** Devices reconnect automatically if the GM reloads. Opening the GM screen on another device takes over hosting, and everyone follows.
- **Proving it works.** Our end-to-end tests count Cloud Function invocations in the Firebase emulator log, and assert **zero calls during an entire combat**. We also stamp each deploy's build ID on the front page, so stale tabs from older deploys are easy to spot.

A close second was the **clash animation**. The engine records each die's Final Power and both characters' Health/Stagger/Sanity after every step. Every screen then replays the clash die by die and shows damage only when its die lands, while the real state stays instantly correct underneath.

## Is anything incomplete, buggy, or planned as a future feature?
- **Effects, Passives and dice effects are text, not automation yet.** They're shown everywhere they matter, but a Passive like "+1 Power on Slash dice" isn't applied by the engine. Automating them is the biggest planned feature.
