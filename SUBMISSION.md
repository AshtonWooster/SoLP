# SoLP: a virtual tabletop for the LoR PMTTRPG

**Theme: Connections.** SoLP brings a tabletop RPG night online so friends can play together from anywhere in the world. The GM runs the table from their browser, players join from their phones, and everyone shares one live battle map, even across continents. The connection runs straight from device to device.

SoLP is built for the **LoR PMTTRPG**, a fan-made tabletop RPG inspired by *Library of Ruina*, where combat means slotting Pages (cards) onto Speed Dice and resolving dice Clashes. That's slow on paper; SoLP runs the rules for you.

---

## Who is the target user for your project?

- **Game Masters** running the LoR PMTTRPG, in person or online. A typical setup is a laptop for GM controls and an iPad or TV for the shared board.
- **Players** joining from their phones. There's no app to install: they open a link or scan the QR code on the board.
- **Groups spread across cities or countries** who want a proper tabletop night together, with a tool that understands this system's card-and-dice combat.

## GitHub / repository link

- App: https://github.com/AshtonWooster/SoLP
- The ruleset it implements: https://github.com/AshtonWooster/LoR_PMTTRPG

## What are the main features of your project?

**Accounts and games**
- Anyone can create a game and become its GM, or join by invite code or QR code.
- Three views of one live table: the **GM screen** (laptop), the **Board** (iPad/TV) and the **Player screen** (phone).

**Characters, built from the rulebook**
- Guided character creation following the rulebook's six steps, with a live checklist.
- A *Library of Ruina*-style card editor for Pages: type the cost, name, dice ranges and effects right on the card, and tap the art to upload an image.
- Weapons and Armor with their own Rank and Passives. Passive Cost and Negative Passive limits are checked as you go.
- Inventory with a Trinket Slot, usable items, and two decks: a 12-Page Combat Deck and an Auxiliary Deck built from your Tools.
- Portraits that appear on your token.

**Combat that runs the rules for you**
- Speed rolls, turn order and the rulebook's turn phases. Phases that need no input pass on their own.
- Players draw a hand and slot Pages on their Speed Dice, and valid targets light up on the board.
- Clashes resolve automatically, including:
  - Block, Evade and Counter Dice.
  - Melee vs. Ranged.
  - Mass Attacks and Instant Pages.
  - Damage and Stagger with Resistances.
  - Staggered and Knocked Out.
- Effects, Passives and dice effects are shown everywhere they matter, but they're text for now. Automating them is our next big feature, along with Advantage/Disadvantage.
- Where the rulebook's tables aren't written yet, the app uses clearly marked placeholders in one file. These include Max Passive Cost, base Movement, Weapon Range and the Story Roll die.
- Clashes play out on the board die by die, like *Library of Ruina*: the dice roll, the winner glows and the loser shatters. Damage lands only when its die plays.
  - Individual Mass Attacks don't animate yet.
  - The log shows results slightly before the animation finishes.
- Redirected Clashes show as two-way arrows, and tokens slide when they move.

**A player screen made for combat**
- One persistent screen: resources, Speed Dice, End Turn, Dash and Story Roll.
- Your hand as cards; tap one to see its full breakdown.
- Pick a die, a target and a Page to slot it, with clear feedback when something isn't allowed.
- See every character's slotted Pages, targets and responses, plus your Effects.

**GM tools**
- Override anything at any time: Health, Stagger, positions, turn order, Effects.
- Enemy templates with their own decks, placed as independent copies.
- Multiple maps with custom backgrounds. Player characters come along when the GM switches, and each map remembers where everyone stood.
- More map tools, like fog of war and drawing, are planned.

## What technology stack did you use?

- **Frontend:** React 19 + TypeScript, Vite, React Router.
- **Real-time play:** WebRTC data channels, the peer-to-peer tech behind video calls. The GM's browser hosts the game.
- **Google Firebase:**
  - Hosting, Authentication, Cloud Storage for images.
  - Firestore for saved data and the WebRTC handshake.
  - Cloud Functions only for creating and joining games.
- **Shared rules engine:** the same TypeScript runs on every device.
- **Testing:**
  - 54 rules-engine tests.
  - 13 security-rules tests against the Firebase emulators.
  - Playwright end-to-end tests that drive the GM, board and phones in one game at once.

## What was the most interesting or technically challenging part your team built?

**Getting usage costs under control by moving gameplay peer-to-peer.**

The first version sent every table action through the cloud: moving a token, changing Health, slotting a Page. Each one called a Cloud Function, wrote to Firestore and fanned out to every device. A single combat has hundreds of small actions times every player, so our usage climbed fast. On hackathon credits, that would only get worse with every group that played.

So we redesigned around the theme: **connect players to each other directly instead of through a server.**

- **The GM's browser became the game server.** It holds the live table and checks every player action against the rules.
- **Phones and the board connect over WebRTC data channels,** like a video call. STUN servers get through home routers, so it works across the internet, not just on the same Wi-Fi.
- **Firestore is only the introduction.** A device posts a connection offer, the GM's tab answers, and from then on traffic goes device-to-device. Firestore otherwise just gets an autosave every few seconds.
- **Cloud Functions dropped to two calls per player, ever:** creating a game and joining one.

This brought its own problems:
- **Hidden information.** The host sends each device only what it may see. Draw piles stay shuffled, enemy hands stay hidden, and the GM's other maps never reach players.
- **Reconnecting.** Devices reconnect automatically if the GM reloads, and opening the GM screen on another device takes over hosting. The trade-off is that the GM's tab must stay open during play; if it closes, everyone waits and reconnects when it's back.
- **Strict networks.** Some mobile carriers and school Wi-Fi block peer-to-peer connections. Those players will need a TURN relay server, which is next on our list.
- **Proving it works.** Our end-to-end tests count Cloud Function calls in the emulator log and require **zero during an entire combat**.

A close second was the **clash animation**. The engine records each die's result and both characters' state after every step. Every screen replays it die by die and shows damage when its die lands, while the real state underneath stays correct.

## Is there anything you'd like judges to notice that may not be obvious from your Devpost submission or GitHub repository?

- **It's a real rules engine, not a dice roller.** The rulebook's Page, Dice and turn-phase rules are implemented and unit-tested in `shared/combat.ts`, from Recycling to Summation ties.
- **Zero server cost per action during play,** by design and enforced by tests.
- **It's built for three devices at once.** Try a laptop as GM, an iPad as the board and a phone as a player. Pick a Page on the phone and watch targets light up on the board, then tap one there to slot it.
- **Players can't cheat.** The host validates actions, hidden information is filtered per device, and tested security rules control who can read and write what. For example, decks are locked during combat.
- **Tested in real browsers.** Our Playwright suites play whole sessions with several browsers at once: joining by invite, building characters, running clashes, switching maps and reloading mid-combat.
