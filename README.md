# Discord Game Badge Presence

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Rich Presence and telemetry simulation scripts for Discord's beta profile badges: **Game Time (Dedicated)** and **Game Variety (Sampler)**.

| Game Time — Dedicated | Game Variety — Sampler |
| :---: | :---: |
| ![Discord Game Time Dedicated badge](assets/game-time-dedicated-anonymous.png) | ![Discord Game Variety Sampler badge](assets/game-variety-sampler-anonymous.png) |

> [!WARNING]
> **Educational & Research Use Only:** Modifying Discord client internals carries inherent risks. Use responsibly. Review [DISCLAIMER.md](DISCLAIMER.md).

---

## Badge Tiers & Targets

| Badge | Max Tier Target | Recommended Command |
| --- | --- | --- |
| **Game Variety (Sampler)** | **100+ Games** (Universalist / Mythic) | Run `multi-game-presence.js` (claims 125 fresh games) |
| **Game Time (Dedicated)** | **5,000 Hours** (Max Badge Ceiling) | Run `game-time-presence.js` (boosts 5,000 hours in 1 shot) |

---

## Features

- **Game Variety (Sampler):** Fetches 10,000+ win32 games directly from Discord's official CDN list (`cdn.discordapp.com/detectables/games.json`).
- **Game Time (Dedicated):** Boosts hours directly via telemetry (`boost(5000)`) up to the 5,000-hour max tier.
- **Duplicate Prevention:** Tracks claimed game IDs in `localStorage` (`__multiGamePresence_claimed_ids`) to ensure new games are prioritized on each run.
- **Rate-Limit Resilience:** Exponential backoff and retry handling for HTTP 429 responses.
- **No Dependencies:** Pure JavaScript meant to run directly in the Discord Desktop console (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd>).
- **Safe In-Memory Execution:** Never writes tokens or credentials to disk.

---

## Quick Start

1. Open Discord Desktop and press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd> (or <kbd>Cmd</kbd> + <kbd>Option</kbd> + <kbd>I</kbd> on macOS) to open DevTools.
   > [!TIP]
   > If DevTools doesn't open on Discord Stable, enable it in `%appdata%/discord/settings.json` (`~/.config/discord/settings.json` on Linux) by adding `"DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOU_ARE_DOING": true`, or use Discord Canary / PTB / Vencord.
2. Go to the **Console** tab.
3. Paste the contents of either script and press <kbd>Enter</kbd>:
   - [`multi-game-presence.js`](multi-game-presence.js) — Claims games for the **Game Variety** badge (default: 125 games).
   - [`game-time-presence.js`](game-time-presence.js) — Claims playtime for the **Game Time** badge (default: 5,000 hours).

*(Run only one script at a time to prevent store conflicts.)*

---

## Usage & Commands

### 1. Game Variety Badge (`multi-game-presence.js`)

```js
// Claim games (gameCount, hoursPerGame)
// Default on load: claims 125 unplayed games with 1.5 hours each
await window.__multiGamePresence.claim(125, 1.5);

// Spread hours across games (e.g., 35 games x 150 hours = 5,250 hours):
await window.__multiGamePresence.claim(35, 150);

// Advance Rich Presence to the next game in rotation:
window.__multiGamePresence.next();

// Inspect active game or stop:
window.__multiGamePresence.current;
window.__multiGamePresence.stop();
```

### 2. Game Time Badge (`game-time-presence.js`)

```js
// Boost playtime hours in a single verified telemetry session:
await window.__gameTimePresence.boost(5000);

// Check credited hours in this session:
window.__gameTimePresence.creditedHours;

// Stop game time presence:
window.__gameTimePresence.stop();
```

---

## FAQ

### How long does it take for badges to update?
**It typically takes 1 to 2 days.**  
Discord processes telemetry events through an asynchronous backend aggregation pipeline (Kafka/ClickHouse). While initial games may show up within a few minutes or after reloading the client (<kbd>Ctrl</kbd> + <kbd>R</kbd>), the full batch can take 24–48 hours to reflect on your profile badge. Avoid resubmitting the same games while the queue is processing.

### Does this interact with Steam or game files?
No. Everything happens purely in-memory inside the Discord client. It does not launch games, modify Steam playtime, interact with VAC, or write to your filesystem.

### How do I stop and clean up?
Call `window.__multiGamePresence.stop()` or `window.__gameTimePresence.stop()`. Reloading Discord (<kbd>Ctrl</kbd> + <kbd>R</kbd>) clears all in-memory changes and restores standard client state.

---

## Disclaimer

This repository is an independent technical experiment and is not affiliated with, endorsed by, or sponsored by Discord, Valve, Steam, or Vencord. All trademarks belong to their respective owners. See [DISCLAIMER.md](DISCLAIMER.md) for full terms.

---

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
