# Discord Game Badge Presence — Game Time & Game Variety

Discord Game Badge tracker and desktop Rich Presence experiment for the beta **Game Time (Dedicated)** and **Game Variety (Sampler)** profile badges. Includes a Counter-Strike 2 presence script and a CDN-driven multi-game presence and claim script for Linux and Windows.

**Related searches:** Discord Game Time badge, Discord Game Variety badge, Discord Dedicated badge, Discord Sampler badge, Discord games played badge, detectable PC games, Discord Rich Presence, Discord game activity, Counter-Strike 2 Discord presence, and Discord Linux game detection.

| Game Time — Dedicated | Game Variety — Sampler |
| --- | --- |
| ![Discord Game Time Dedicated badge with an anonymized username](assets/game-time-dedicated-anonymous.png) | ![Discord Game Variety Sampler badge with an anonymized username](assets/game-variety-sampler-anonymous.png) |

> [!WARNING]
> **EDUCATIONAL AND RESEARCH PURPOSES ONLY — ACCOUNT BAN RISK:** This repository is published solely to study Discord desktop game-detection and presence behavior. These scripts are not an official Discord feature or API. They modify undocumented Discord client internals and generate synthetic game activity. Their use may lead to warnings, badge progress removal, temporary suspension, or permanent account termination. They are not undetectable, approved, or ban-safe. If you are unwilling to accept the possibility of losing your Discord account, do not run them. Labeling the project educational does not override Discord's rules or eliminate enforcement risk.

By downloading, running, modifying, or distributing this project, you assume all risks associated with your use. The authors and contributors are not responsible for account bans, suspensions, lost data, lost purchases, lost rewards, client instability, or other consequences, to the maximum extent permitted by applicable law. Read the full [Disclaimer and Assumption of Risk](DISCLAIMER.md) before using the scripts.

## What this repository does

Discord's beta game badges measure detectable PC game activity while the desktop client is open. This repository explores that client-side detection path through two dependency-free JavaScript scripts:

| Script | Purpose | Platforms | Schedule / Features |
| --- | --- | --- | --- |
| `cs2-presence.js` | Counter-Strike 2 Rich Presence + Game Time hours booster (`boost(5000)`) | Linux, Windows | Refreshes every 5 mins; one-shot science telemetry booster |
| `multi-game-presence.js` | CDN game catalog loader + Game Variety badge claimer (`claim(count, hours)`) | Linux, Windows | Random 23–38 min rotation; automatic batch claimer with duplicate tracking |

The scripts patch Discord's internal `RunningGameStore` and dispatch local game-activity events. They also post verified `launch_game` and `running_game_heartbeat` events to Discord's science analytics endpoint (`/api/v9/science`). They do not launch games, modify Steam playtime, connect to game servers, or interact with VAC.

Badge availability, thresholds, and progression behavior may differ between accounts and Discord client versions because the badge system is in beta. These scripts cannot guarantee badge eligibility or progression.

## Features

- **Game Variety Engine:** Loads 10,000+ win32 games directly from Discord's CDN (`cdn.discordapp.com/detectables/games.json`).
- **Game Time Booster:** Boost hours in a single verified session up to the 5,000-hour badge cap using `cs2-presence.js`.
- **Claim State Tracking:** Remembers previously claimed game IDs in browser `localStorage` (`__multiGamePresence_claimed_ids`) to prioritize unplayed games and avoid redundant submissions.
- **Rate-Limit Resilience:** Automatic exponential backoff and jitter for Discord HTTP 429 (Too Many Requests) responses.
- **Dedicated Counter-Strike 2 Mode:** Authentic App ID (`1158877933042143272`) Rich Presence with dynamic heartbeat telemetry.
- **Automatic Platform Detection:** Dynamically switches between Windows PE fingerprints and Linux executable structures based on user agent.
- **Safe In-Memory Execution:** Reads authentication token in-memory only to request short-lived analytics tokens; never writes credentials or tokens to disk.
- **Clean Teardown:** Restores original Discord Webpack store methods and clears activities on `stop()` or window close.

## Requirements

- Discord desktop client
- Access to the Discord developer console (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd>)
- A Discord version that exposes the required internal Webpack modules

Discord updates can rename or restructure internal modules, so either script may stop working after a client update. Flatpak, Snap, Vencord, and other modified Discord packages may expose different module behavior.

## Quick start

1. Open the Discord desktop client.
2. Open its developer console (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>I</kbd>).
3. Open either `cs2-presence.js` or `multi-game-presence.js` from this repository.
4. Copy the complete file contents into the console.
5. Run the script and check the console for its activation message.

> [!NOTE]
> Run only one presence script at a time. Both scripts patch the same Discord store methods and can interfere with each other.

## Commands

### Counter-Strike 2 (`cs2-presence.js`)

#### Boost CS2 Playtime Hours

```js
// Credits 5,000 hours in a single verified telemetry session (default on load)
await window.__cs2Presence.boost(5000)

// Or specify custom hours:
await window.__cs2Presence.boost(150)
```

#### Check Credited Hours

```js
window.__cs2Presence.creditedHours
```

#### Stop Counter-Strike 2 Presence

```js
window.__cs2Presence.stop()
```

---

### Multi-Game Presence (`multi-game-presence.js`)

#### Claim Games for Game Variety Badge

```js
// Claim 125 fresh games with 1.5 hours each (runs automatically on load)
await window.__multiGamePresence.claim(125, 1.5)

// Claim 35 games with 150 hours each (spreads 5,250 hours across diverse games)
await window.__multiGamePresence.claim(35, 150)

// Claim all win32 games in the CDN catalog
await window.__multiGamePresence.claim(Infinity, 1.0)
```

#### Advance to the Next Game Immediately

```js
window.__multiGamePresence.next()
```

Manual advancement does not reset the currently scheduled automatic transition.

#### Inspect Current Game & Catalog

```js
// View currently active game
window.__multiGamePresence.current

// View all loaded game entries
window.__multiGamePresence.games
```

#### Stop Multi-Game Rotation

```js
window.__multiGamePresence.stop()
```

## How it works

The scripts locate Discord's Webpack module registry, resolve `RunningGameStore` and the Flux dispatcher, and inject a synthetic game record. They then dispatch local game-state and activity events resembling Discord's desktop game-detection flow.

For telemetry claims, the scripts build a stable client identity and executable fingerprint, then post `launch_game` and `running_game_heartbeat` events to `/api/v9/science` in rate-limited batches with retry logic.

- `cs2-presence.js` simulates a long-running session for Counter-Strike 2 (`1158877933042143272`) to advance the **Game Time** badge.
- `multi-game-presence.js` samples unplayed games from the CDN list to advance the **Game Variety** badge, rotating the active Rich Presence and tracking claimed games in `localStorage`.

Calling `stop()` clears the active timer, restores the original store methods, removes the synthetic game, and clears its local activity.

## Discord Game Badge FAQ

### Does this unlock the Discord Dedicated or Sampler badge?

Not necessarily. The badges are in beta, availability may be account-specific, and Discord can change detection or progression rules. The scripts reproduce local presence signals and the multi-game script posts analytics claim events, but neither can guarantee server-side badge credit.

### Can Discord display all games simultaneously?

No. Discord displays one primary Playing activity. The multi-game script rotates through the loaded list sequentially, while a claim marks many games in batches without displaying them all at once.

### Does it work on Linux?

The presence path detects Linux through the client user agent and emits Linux-style executable metadata. The claim path uses Windows executable metadata and a PE-style fingerprint to match the analytics event shape. Flatpak, Snap, Vencord, and Discord updates can affect access to internal modules.

### Does it work on Windows?

Yes, the scripts select Windows-style presence metadata when the client is not running on Linux. Compatibility still depends on the current Discord internal module structure.

### Does it run 24/7?

Only while the Discord desktop client and the script remain running. The claim is one-shot; the presence rotation stops when Discord is closed or reloaded. The scripts do not install persistence or restart automatically.

### Is it safe for a Discord account?

No account-safety guarantee is made. This is an unofficial client-internals experiment, and Discord may treat automated, modified, or synthetic client behavior as a policy violation.

### Does it steal Discord tokens or send data elsewhere?

The multi-game script reads the local Discord token in memory to request a short-lived analytics token, then posts claim events to `discord.com`. It does not write the token to disk. Always review source code before running it.

### Does it modify Counter-Strike 2, Steam, or VAC?

No. It does not attach to the CS2 process, modify game files, change Steam playtime, or communicate with VAC. It only changes in-memory state inside the Discord client.

### How long does it take for badges to update?

Badge progression does **not** update immediately. Discord processes telemetry events asynchronously through its backend analytics aggregation pipeline. While some initial games may appear within minutes or after reloading the client (<kbd>Ctrl</kbd> + <kbd>R</kbd>), it typically takes **1 to 2 days** for the full batch of claimed games to process and reflect on your profile badge. Avoid repeatedly submitting the same games while they are pending in the server processing queue.

## Limitations

- No real game process is launched.
- Steam status, game time, and in-game data are not changed.
- Discord reloads and restarts stop the scripts.
- Application IDs and executable names come from Discord's CDN game list; `DetectableGameStore` is used as a fallback.
- The auto claim defaults to the first 125 win32 games. Set `AUTO_CLAIM_COUNT` to `Infinity` to claim the full CDN list (10,000+ games and many requests).
- A real game can conflict with the synthetic activity's display priority.
- Synthetic executable paths are metadata and do not point to launched processes.
- Discord can change internal APIs without notice.
- Badge progression is not instant; Discord's backend analytics aggregation typically takes **1 to 2 days** to fully process claimed games and reflect on profile badges.

## Troubleshooting

### `Discord webpack registry was not found`

The script may be running in Discord Web, an incompatible desktop build, or an environment where the Webpack registry is unavailable.

### `RunningGameStore/Dispatcher was not found`

Discord may have changed internal module names or structures. The module lookup logic must be adapted to that client release.

### `CDN game list failed`

The script falls back to `DetectableGameStore`. If both fail, reload Discord and retry, or check whether the client can reach `cdn.discordapp.com`.

### `Discord token could not be found` or `analytics_token could not be retrieved`

The client session may be stale or the internal stores changed. Reload Discord, log in again if needed, and rerun the script.

### The activity is not visible

- Verify that Discord's setting to display current activity as a status message is enabled.
- Check the developer console for the script's activation or error message.
- Confirm that only one presence script is running.
- Stop the script and restart Discord before retrying.

## Cleanup

Run the relevant `stop()` command first. The multi-game `stop()` also halts an in-progress claim at the next batch. Restarting Discord clears all remaining in-memory changes. Neither script starts automatically after a restart.

## Privacy

The screenshots displayed in this README use an anonymized placeholder instead of the account username. Avoid publishing raw Discord badge screenshots that expose a username, avatar, account identifier, server name, or other linkable profile information.

The JavaScript scripts read the Discord token in memory and never write credentials to disk.

## Disclaimer

This repository is an independent technical experiment and is not affiliated with, endorsed by, or sponsored by Discord, Valve, Steam, or Vencord. Discord and all referenced game names are trademarks of their respective owners. The software is provided **"AS IS"** without warranties or guarantees. See [DISCLAIMER.md](DISCLAIMER.md) for the complete account-risk, no-warranty, and limitation-of-responsibility notice.
