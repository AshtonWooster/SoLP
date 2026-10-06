# SoLP: A virtual tabletop platform
**Ashton Wooster** & **Tyler Ruf**   
**Try it out:** https://solp.online

**Theme: Connections.** SoLP brings a tabletop RPG night online, so friends anywhere in the world can play together. The GM runs the table from their browser, players join from their phones, and everyone shares one live battle map, connected device to device.

It's built for the **LoR PMTTRPG**, a fan-made tabletop RPG inspired by *Library of Ruina*, where combat means slotting Pages (cards) onto Speed Dice and resolving dice Clashes. That's slow on paper; SoLP runs the rules for you.

---

## Who is the target user for your project?

**The problem:** tabletop groups are stuck choosing between two options.
- **Physical boards** are interactive but expensive, and only work when everyone is in the same room.
- **Online tabletops** like Roll20 and Foundry connect people anywhere, but they cost money and don't support custom rule systems, so players still track combat by hand.

**SoLP is the bridge.** A live board screen (iPad or TV) shows the table like a real game board, and each player's phone is their personal "remote": they pick Pages, aim at targets and watch them light up on the board. It's as interactive as playing in person, in one room or across continents, with the system's own rules built in.

It's for:
- **Game Masters** running the LoR PMTTRPG, usually with a laptop for controls and an iPad or TV for the board.
- **Players** on their phones. No install: open a link or scan the QR code on the board.

## GitHub / repository link

- App: https://github.com/AshtonWooster/SoLP
- The ruleset it implements: https://github.com/AshtonWooster/LoR_PMTTRPG

## What are the main features of your project?

**Games and characters**
- Create a game as GM, or join by invite code or QR code.
- Three views of one live table: **GM screen** (laptop), **Board** (iPad/TV) and **Player screen** (phone).
- Interactive character creation: a Fixer License ID card, stat allocation, personality, and a summary of everything with what's left.
- A *Library of Ruina*-style card editor: type cost, name, dice ranges and effects right on the card, and tap the art to upload an image.
- Weapons and Armor with their own Rank and Passives, with cost limits checked as you go.
- Inventory, a Trinket Slot, Combat and Auxiliary Decks, and portraits on tokens.

**Combat that runs the rules for you**
- Speed rolls, turn order and the rulebook's turn phases. Phases that need no input pass on their own.
- Slot Pages on your phone; valid targets light up on the board.
- Clashes resolve automatically: Block, Evade and Counter Dice, Recycling, Melee vs. Ranged, Mass Attacks, Instant Pages, Resistances, Stagger and Knock Out.
- Clashes play out die by die like *Library of Ruina*: the dice roll, the winner glows and the loser shatters, and damage lands when its die plays.

**Player screen and GM tools**
- One persistent phone screen: resources, Speed Dice, End Turn, Dash, Story Roll and your hand as cards. Pick a die, a target and a Page to slot it.
- See every character's slotted Pages, targets and responses, plus your Effects.
- The GM can override anything: Health, Stagger, positions, turn order, Effects.
- A Character editor for enemies, allies and NPCs: reuse any Weapon, Armor, Augment or Page already built in the game, override Resources, and export or import characters to share with other GMs.
- Multiple maps with custom backgrounds, like Roll20 pages. Players come along when the GM switches, and each map remembers where everyone stood.

## What technology stack did you use?

- **Frontend:** React 19 + TypeScript, Vite, React Router.
- **Real-time play:** WebRTC data channels, the peer-to-peer tech behind video calls, hosted in the GM's browser.
- **Google Firebase:**
  - Hosting, Authentication, and Cloud Storage for images.
  - Firestore for saved data and the WebRTC handshake.
  - Cloud Functions only for creating and joining games.
- **Shared rules engine:** the same TypeScript runs on every device.
- **Testing:** 54 rules-engine tests, 13 security-rules tests against the Firebase emulators, and Playwright tests that drive the GM, board and phones in one game at once.

## What was the most interesting or technically challenging part your team built?

**Getting usage costs under control by moving gameplay peer-to-peer.**

Our first version sent every table action through the cloud: moving a token, changing Health, slotting a Page. Each one called a Cloud Function, wrote to Firestore and fanned out to every device. A single combat has hundreds of small actions times every player, so usage grew fast. On hackathon credits, that would only get worse with every group that played.

So we redesigned around the theme: **connect players to each other directly instead of through a server.**

- **The GM's browser became the game server**, holding the live table and checking every player action against the rules.
- **Phones and the board connect over WebRTC data channels**, like a video call. STUN servers get through home routers, so it works across the internet, not just one Wi-Fi network.
- **Firestore is only the "introduction".** A device posts a connection offer and the GM's tab answers; after that, traffic goes device-to-device. Firestore otherwise just gets an autosave every few seconds.
- **Cloud Functions dropped to two calls per player, ever:** creating a game and joining one.

This created new problems to solve:
- **Hidden information:** each device receives only what it may see. Draw piles stay shuffled, enemy hands stay hidden, and the GM's other maps never reach players.
- **Robust connections:** devices reconnect automatically if the GM reloads, and opening the GM screen on another device takes over hosting.
- **Proving it works:** our end-to-end tests count Cloud Function calls in the emulator log and require **zero during an entire combat**.

A close second was the **clash animation**: the engine records each die's result and both characters' state, so screens replay clashes die by die and show damage only when its die lands.

## Is anything incomplete, buggy, or planned as a future feature?
- **Effects, Passives and dice effects are text, not automation yet.** They're shown everywhere they matter, but a Passive like "+1 Power on Slash dice" isn't applied by the engine. Automating them is the biggest planned feature.
