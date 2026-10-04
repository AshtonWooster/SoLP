# SoLP: a virtual tabletop for the LoR PMTTRPG

**Theme: Connections.** SoLP brings a tabletop RPG night online so friends can play together from anywhere in the world. The GM runs the table from their browser and players join from their phones, sharing one live battle map across continents, connected device to device.

It's built for the **LoR PMTTRPG**, a fan-made tabletop RPG inspired by *Library of Ruina*. Combat means slotting Pages (cards) onto Speed Dice and resolving dice Clashes. That's slow on paper, so SoLP runs the rules for you.

---

## Who is the target user for your project?

- **Game Masters** running the LoR PMTTRPG, in person or online, typically with a laptop for controls and an iPad or TV for the board.
- **Players** on their phones. No install: open a link or scan the QR code on the board.
- **Groups spread across cities or countries** who want a real tabletop night together, with a tool that understands this system's combat.

## GitHub / repository link

- App: https://github.com/AshtonWooster/SoLP
- Ruleset: https://github.com/AshtonWooster/LoR_PMTTRPG

## What are the main features of your project?

**Games and characters**
- Create a game as GM, or join by invite code or QR code.
- Three views of one live table: **GM screen**, **Board** and **Player screen**.
- Guided character creation following the rulebook's six steps, with a live checklist.
- A *Library of Ruina*-style card editor: type cost, name, dice ranges and effects right on the card, and tap the art to upload an image.
- Weapons and Armor with their own Rank and Passives, with cost limits checked as you go.
- Inventory, a Trinket Slot, a Combat Deck, an Auxiliary Deck, and portraits on tokens.

**Combat that runs the rules**
- Speed rolls, turn order and turn phases; phases with nothing to do pass on their own.
- Slot Pages on your phone; valid targets light up on the board.
- Clashes resolve automatically: Block, Evade and Counter Dice, Melee vs. Ranged, Mass Attacks, Resistances, Stagger and Knock Out.
- Clashes animate die by die like *Library of Ruina*. The winner glows, the loser shatters, and damage lands when its die does. Individual Mass Attacks don't animate yet.
- Effects and Passives are shown as text for now; automating them is our next big feature. Unfinished tables in the rulebook use clearly marked placeholders.

**Player screen and GM tools**
- One persistent phone screen with your resources, actions and hand as cards. Pick a die, a target and a Page to slot it.
- See every character's slotted Pages and targets.
- The GM can override anything: Health, positions, turn order, Effects.
- Enemy templates with their own decks.
- Multiple maps with custom backgrounds. Players come along when the GM switches, and each map remembers positions.

## What technology stack did you use?

- **Frontend:** React 19 + TypeScript, Vite.
- **Real-time play:** WebRTC data channels (the tech behind video calls), hosted in the GM's browser.
- **Google Firebase:** Hosting, Authentication, Cloud Storage for images, Firestore for saved data and the connection handshake, and Cloud Functions only for creating and joining games.
- **Shared rules engine:** the same TypeScript on every device.
- **Testing:** 54 rules tests, 13 security-rules tests against the Firebase emulators, and Playwright tests that drive the GM, board and phones together.

## What was the most interesting or technically challenging part your team built?

**Moving gameplay peer-to-peer to get usage costs under control.**

Our first version sent every action through the cloud. Moving a token, changing Health or slotting a Page each called a Cloud Function, wrote to Firestore and fanned out to every device. A combat has hundreds of small actions times every player, so usage climbed fast, and on hackathon credits it would only get worse.

So we redesigned around the theme: **connect players to each other, not to a server.**

- **The GM's browser became the game server**, holding the live table and checking every action against the rules.
- **Devices connect over WebRTC data channels**, like a video call. STUN servers get through home routers, so it works across the internet, not just one Wi-Fi network.
- **Firestore only makes the introduction.** A device posts a connection offer and the GM's tab answers; after that, traffic goes device-to-device. Firestore otherwise just gets an autosave every few seconds.
- **Cloud Functions dropped to two calls per player, ever:** create a game and join one.

That brought new problems:
- **Hidden information:** each device receives only what it may see. Draw piles stay shuffled, enemy hands stay hidden, and other maps stay with the GM.
- **Reconnecting:** devices reconnect if the GM reloads, and another device can take over hosting. The trade-off is that the GM's tab must stay open during play.
- **Strict networks:** some carriers and school Wi-Fi block peer-to-peer connections. Those players will need a TURN relay, which is next on our list.
- **Proof:** our end-to-end tests count Cloud Function calls and require **zero during an entire combat**.

A close second was the **clash animation**. The engine records each die's result and both characters' state after every step. Screens replay it die by die and show damage when its die lands, while the real state stays correct underneath.

## Is there anything you'd like judges to notice that may not be obvious from your Devpost submission or GitHub repository?

- **A real rules engine, not a dice roller:** the rulebook's Page, Dice and turn rules are implemented and unit-tested.
- **Zero server cost per action during play**, by design and enforced by tests.
- **Built for three devices at once.** Pick a Page on a phone, watch targets light up on the board, and tap one there to slot it.
- **No cheating:** the host validates every action, hidden information is filtered per device, and tested security rules lock decks during combat.
- **Tested in real browsers:** our suites play full sessions with several browsers at once, from invites and character creation to clashes, map switches and mid-combat reloads.
