(async () => {
    "use strict";

    const LOCK = "__gameTimePresence";
    if (window[LOCK] && !window[LOCK].loading) {
        console.warn("[Game Time Presence] Already running. To stop: window.__gameTimePresence.stop()");
        return;
    }
    window[LOCK] = { loading: true };
    window.__cs2Presence = window[LOCK];

    const IS_LINUX = /Linux/i.test(navigator.userAgent);
    const PRIMARY_GAME = Object.freeze(IS_LINUX ? {
        id: "1158877933042143272",
        name: "Counter-Strike 2",
        exeName: "cs2",
        exePath: "/home/user/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2",
        cmdLine: "/home/user/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2",
        os: "linux"
    } : {
        id: "1158877933042143272",
        name: "Counter-Strike 2",
        exeName: "cs2.exe",
        exePath: "c:/program files (x86)/steam/steamapps/common/counter-strike global offensive/game/bin/win64/cs2.exe",
        cmdLine: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe",
        os: "win32"
    });

    // Game Time ceiling is 5,000h. Submit 6,000h across 250 games (24h each) so per-session
    // caps or dropped events still leave enough buffer to reach the max tier.
    const AUTO_BOOST = true;
    const TOTAL_TARGET_HOURS = 6000;
    const GAMES_TO_SPREAD = 250;
    const HOURS_PER_GAME = TOTAL_TARGET_HOURS / GAMES_TO_SPREAD; // 24 hours
    const BATCH_SIZE = 25;
    const BATCH_DELAY_MS = 450;

    const CDN_GAMES_URL = "https://cdn.discordapp.com/detectables/games.json";

    const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const sha256 = async value => new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    );

    function getWebpackRequire() {
        if (typeof webpackChunkdiscord_app !== "undefined") {
            let req;
            webpackChunkdiscord_app.push([[Symbol("game-time-presence")], {}, r => {
                if (Object.keys(r?.c ?? {}).length > Object.keys(req?.c ?? {}).length) req = r;
            }]);
            webpackChunkdiscord_app.pop();
            if (req) return req;
        }
        if (window.Vencord?.Webpack?.wreq?.c) return window.Vencord.Webpack.wreq;
        return null;
    }

    const HTTP_METHODS = ["get", "post", "del"];

    function isHttpClient(candidate) {
        return candidate != null && HTTP_METHODS.every(method => typeof candidate[method] === "function");
    }

    function unwrapExports(value) {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
        return [value, value.default, ...Object.values(value)];
    }

    function resolveHttpClient(requireFn) {
        for (const [id, factory] of Object.entries(requireFn?.m ?? {})) {
            let source = "";
            try {
                source = typeof factory === "function" ? factory.toString() : "";
            } catch (_) {}
            if (!source.includes("HTTPUtils")) continue;
            try {
                const client = unwrapExports(requireFn(id)).find(isHttpClient);
                if (client) return client;
            } catch (_) {}
        }
        for (const cached of Object.values(requireFn?.c ?? {})) {
            try {
                const client = unwrapExports(cached?.exports).find(isHttpClient);
                if (client) return client;
            } catch (_) {}
        }
        return null;
    }

    function exportsFrom(req) {
        return Object.values(req?.c ?? {}).flatMap(module => {
            try {
                const exp = module?.exports;
                if (!exp) return [];
                return [exp, exp.default, ...(typeof exp === "object" ? Object.values(exp) : [])];
            } catch (_) {
                return [];
            }
        }).filter(Boolean);
    }

    function findStore(exports, displayName) {
        const origWarn = console.warn;
        try {
            console.warn = () => {};
            return exports.find(value => {
                try {
                    return value && typeof value === "object" &&
                        (value.getName?.() === displayName || value.__proto__?.constructor?.displayName === displayName);
                } catch (_) {
                    return false;
                }
            });
        } finally {
            console.warn = origWarn;
        }
    }

    function findDispatcher(exports) {
        const origWarn = console.warn;
        try {
            console.warn = () => {};
            return exports.find(value => value && typeof value.dispatch === "function" &&
                typeof value.subscribe === "function" && value._subscriptions);
        } finally {
            console.warn = origWarn;
        }
    }

    try {
        const req = getWebpackRequire();
        if (!req?.c) throw new Error("Discord Webpack registry was not found.");

        const rest = resolveHttpClient(req);

        const exports = exportsFrom(req);
        const runStore = findStore(exports, "RunningGameStore");
        const dispatcher = findDispatcher(exports);
        if (!runStore || !dispatcher) throw new Error("RunningGameStore/Dispatcher was not found; incompatible Discord version.");

        async function makeExecutableFingerprint(userId) {
            const machineId = uuid();
            const header = await sha256("pe_header_" + userId);
            const machine = await sha256(machineId + userId);
            const sections = await sha256("pe_section_" + userId);
            const certificate = await sha256("pe_cert_" + userId);
            const mask = await sha256(userId + "https://discord.com/careers");

            const binary = new Uint8Array(146);
            const writer = new DataView(binary.buffer);
            binary[0] = 1;
            binary[1] = 1;
            writer.setBigUint64(2, 65432100n, true);
            writer.setUint32(10, 1690000000, true);
            writer.setUint32(14, 0x02500000, true);
            binary.set(header, 18);
            binary.set(machine, 50);
            binary.set(sections, 82);
            binary.set(certificate, 114);

            for (let index = 1; index < binary.length; index++) {
                binary[index] ^= mask[(index - 1) % mask.length];
            }
            return btoa(String.fromCharCode(...binary));
        }

        const launchSignature = uuid();
        const heartbeatSession = uuid();
        let identity = null;

        async function loadIdentity() {
            if (identity) return identity;
            if (!rest) throw new Error("Discord's internal HTTP client could not be located.");
            const response = await rest.get({ url: "/users/@me", query: { with_analytics_token: true } });
            const profile = response?.body ?? {};
            const analyticsToken = profile.analytics_token;
            const userId = profile.id == null ? "" : String(profile.id);
            if (!analyticsToken) throw new Error("analytics_token is missing from the current session.");
            if (!/^\d+$/.test(userId)) throw new Error("Could not resolve the current Discord user ID.");
            const fingerprint = await makeExecutableFingerprint(userId);
            identity = { analyticsToken, fingerprint };
            return identity;
        }

        async function fetchGameCatalog() {
            let source = null;
            try {
                const response = await rest?.get({ url: "/applications/detectable" });
                const payload = response?.body;
                source = Array.isArray(payload) ? payload : payload?.applications;
            } catch (_) {}
            if (!Array.isArray(source)) {
                try {
                    const response = await fetch(CDN_GAMES_URL);
                    if (response.ok) source = await response.json();
                } catch (_) {}
            }
            if (!Array.isArray(source)) throw new Error("Discord's detectable-game catalog is unavailable.");

            const unique = new Map();
            for (const app of source) {
                if (app?.id == null) continue;
                const id = String(app.id);
                if (unique.has(id)) continue;
                const executable = app?.executables?.find(entry => entry?.os === "win32" && entry?.name);
                if (!executable) continue;
                unique.set(id, {
                    id,
                    name: app?.name ?? "Unknown",
                    exe: executable.name.replace(/^>/, "")
                });
            }
            if (unique.size === 0) throw new Error("No detectable Windows games were found.");
            return [...unique.values()];
        }

        let seq = 0;
        const nextSeq = () => ++seq;

        const buildSessionEvents = (gameEntry, durationMs, fingerprint) => {
            const sessionId = uuid();
            const now = Date.now();
            const start = Math.max(0, now - durationMs);
            const jitter = Math.floor(Math.random() * 450) + 120;

            const launchProps = {
                client_track_timestamp: start + jitter,
                client_heartbeat_session_id: heartbeatSession,
                game: gameEntry.name,
                game_id: gameEntry.id,
                verified: true,
                elevated: false,
                is_launcher: false,
                game_platform: "desktop",
                detection_method: "verified_game",
                is_overlay_enabled: false,
                is_overlay_game_enabled: true,
                is_overlay_game_source: "OOP_DEFAULT_DATABASE",
                fullscreen_type: "UNKNOWN",
                hardware_display_count: 1,
                overlay_method: "Disabled",
                activity_status_enabled: true,
                activity_status_shared_guilds: [],
                current_user_status: "online",
                game_detection_enabled: true,
                executable_path: gameEntry.exe,
                voice_channel_id: null,
                voice_channel_type: null,
                voice_channel_bitrate: null,
                voice_channel_guild_id: null,
                hidden_by_distributor: false,
                game_metadata: null,
                executable_fingerprint: fingerprint,
                client_performance_cpu: null,
                client_performance_memory: null,
                cpu_core_count: null,
                accessibility_features: 0,
                rendered_locale: "en-US",
                launch_signature: launchSignature,
                client_rtc_state: null,
                client_app_state: "focused",
                client_send_timestamp: start + jitter
            };

            const events = [
                {
                    type: "running_game_heartbeat",
                    properties: {
                        client_track_timestamp: start,
                        client_heartbeat_session_id: heartbeatSession,
                        game_id: gameEntry.id,
                        game_name: gameEntry.name,
                        game_metadata: null,
                        game_executable: gameEntry.exe,
                        game_detection_enabled: true,
                        initial_heartbeat: true,
                        final_heartbeat: false,
                        game_session_id: sessionId,
                        duration_tracked_ms: 0,
                        rtc_connection_id: null,
                        media_session_id: null,
                        launch_signature: launchSignature,
                        client_app_state: "focused",
                        client_send_timestamp: start
                    }
                },
                {
                    type: "launch_game",
                    properties: launchProps
                },
                {
                    type: "running_game_heartbeat",
                    properties: {
                        client_track_timestamp: now,
                        client_heartbeat_session_id: heartbeatSession,
                        game_id: gameEntry.id,
                        game_name: gameEntry.name,
                        game_metadata: null,
                        game_executable: gameEntry.exe,
                        game_detection_enabled: true,
                        initial_heartbeat: false,
                        final_heartbeat: true,
                        game_session_id: sessionId,
                        duration_tracked_ms: durationMs,
                        rtc_connection_id: null,
                        media_session_id: null,
                        launch_signature: launchSignature,
                        client_app_state: "focused",
                        client_send_timestamp: now
                    }
                }
            ];

            for (const event of events) {
                event.properties.event_sequence_number = nextSeq();
            }
            return events;
        };

        const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));

        async function sendScienceBatch(events, context, attempt = 0) {
            try {
                const response = await rest.post({
                    url: "/science",
                    body: { token: context.analyticsToken, events }
                });
                if (response?.ok || response?.status === 200 || response?.status === 204) return true;
                if (response?.status === 429 && attempt < 3) {
                    console.warn("[Game Time Booster] Rate limited; cooling down for 2.5s.");
                    await wait(2.5);
                    return sendScienceBatch(events, context, attempt + 1);
                }
                return false;
            } catch (error) {
                const status = error?.status ?? error?.statusCode;
                if (status === 429 && attempt < 3) {
                    const header = error?.headers?.get?.("retry-after") ?? error?.headers?.["retry-after"];
                    const parsed = Number.parseFloat(header);
                    const delay = Number.isFinite(parsed) ? Math.max(parsed, 2) : 2.5;
                    console.warn(`[Game Time Booster] Rate limited; cooling down for ${delay.toFixed(1)}s.`);
                    await wait(delay);
                    return sendScienceBatch(events, context, attempt + 1);
                }
                if (attempt < 2) {
                    await wait(1.5);
                    return sendScienceBatch(events, context, attempt + 1);
                }
                throw error;
            }
        }

        // --- Rich Presence Engine (Counter-Strike 2) ---
        const original = {};
        const patchable = [
            "getRunningGames", "getGameForPID", "getVisibleGame", "getVisibleRunningGames",
            "getCandidateGames", "getRunningDiscordApplicationIds"
        ];
        for (const key of patchable) {
            if (typeof runStore[key] === "function") original[key] = runStore[key];
        }
        if (!original.getRunningGames || !original.getGameForPID) {
            throw new Error("Required RunningGameStore methods missing.");
        }

        const pid = 40000 + Math.floor(Math.random() * 20000);
        const startedAt = Date.now();
        const activePresenceGame = {
            id: PRIMARY_GAME.id,
            name: PRIMARY_GAME.name,
            pid,
            pidPath: [pid],
            processName: PRIMARY_GAME.name,
            start: startedAt,
            exeName: PRIMARY_GAME.exeName,
            exePath: PRIMARY_GAME.exePath,
            cmdLine: PRIMARY_GAME.cmdLine,
            executables: [{ os: PRIMARY_GAME.os, name: PRIMARY_GAME.exeName, is_launcher: false }],
            windowHandle: 0,
            fullscreenType: 0,
            overlay: true,
            sandboxed: false,
            hidden: false,
            isLauncher: false
        };

        const withoutOurs = games => (games ?? []).filter(item => item?.pid !== pid);
        runStore.getRunningGames = () => [...withoutOurs(original.getRunningGames.call(runStore)), activePresenceGame];
        runStore.getGameForPID = value => value === pid ? activePresenceGame : original.getGameForPID.call(runStore, value);
        if (original.getVisibleGame) runStore.getVisibleGame = () => activePresenceGame;
        if (original.getVisibleRunningGames) {
            runStore.getVisibleRunningGames = () => [...withoutOurs(original.getVisibleRunningGames.call(runStore)), activePresenceGame];
        }
        if (original.getCandidateGames) {
            runStore.getCandidateGames = () => [...withoutOurs(original.getCandidateGames.call(runStore)), activePresenceGame];
        }
        if (original.getRunningDiscordApplicationIds) {
            runStore.getRunningDiscordApplicationIds = () => {
                const ids = original.getRunningDiscordApplicationIds.call(runStore) ?? [];
                return ids.includes(activePresenceGame.id) ? ids : [...ids, activePresenceGame.id];
            };
        }

        const announce = () => {
            dispatcher.dispatch({
                type: "RUNNING_GAMES_CHANGE",
                added: [activePresenceGame],
                removed: [],
                games: runStore.getRunningGames()
            });
            dispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                socketId: null,
                pid,
                activity: {
                    name: PRIMARY_GAME.name,
                    type: 0,
                    application_id: PRIMARY_GAME.id,
                    details: null,
                    state: null,
                    timestamps: { start: startedAt },
                    assets: null
                }
            });
        };

        // --- Playtime Booster ---
        // Submits short, recent sessions (24h per game) through Discord's own REST layer.
        // The badge ceiling is 5,000h; 250 games x 24h gives 6,000h of buffer.
        let totalCreditedHours = 0;
        let isBoosting = false;
        let stopped = false;

        const boost = async (targetTotalHours = TOTAL_TARGET_HOURS, gameCount = GAMES_TO_SPREAD) => {
            if (stopped) return 0;
            if (isBoosting) {
                console.warn("[Game Time Booster] Boost already in progress. Please wait.");
                return 0;
            }
            if (!Number.isFinite(targetTotalHours) || targetTotalHours <= 0) {
                console.warn("[Game Time Booster] Invalid target hours.");
                return 0;
            }
            isBoosting = true;
            try {
                console.log("[Game Time Booster] Fetching verified game catalog...");
                const allGames = await fetchGameCatalog();
                for (let i = allGames.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [allGames[i], allGames[j]] = [allGames[j], allGames[i]];
                }
                const selectedGames = allGames.slice(0, Math.min(gameCount, allGames.length));
                const hoursPerGame = targetTotalHours / selectedGames.length;
                const durationMs = Math.round(hoursPerGame * 3600 * 1000);

                console.log(`[Game Time Booster] Spreading ${targetTotalHours}h across ${selectedGames.length} verified games (~${hoursPerGame.toFixed(1)}h per game)...`);
                console.log("[Game Time Booster] Using short, recent sessions to avoid ingestion-window drops.");

                const context = await loadIdentity();
                if (stopped) return 0;

                let credited = 0;
                for (let i = 0; i < selectedGames.length; i += BATCH_SIZE) {
                    if (stopped) break;
                    const chunk = selectedGames.slice(i, i + BATCH_SIZE);
                    const events = chunk.flatMap(game =>
                        buildSessionEvents(game, durationMs, context.fingerprint)
                    );

                    const ok = await sendScienceBatch(events, context);
                    if (ok) {
                        const batchHours = chunk.length * hoursPerGame;
                        credited += batchHours;
                        totalCreditedHours += batchHours;
                        console.log(`[Game Time Booster] Progress: Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(selectedGames.length / BATCH_SIZE)} accepted (+${batchHours.toFixed(0)}h, Total: ${totalCreditedHours.toFixed(0)}h / ${targetTotalHours}h)`);
                    } else {
                        console.warn(`[Game Time Booster] Batch starting at index ${i} failed.`);
                    }

                    if (i + BATCH_SIZE < selectedGames.length && !stopped) {
                        const delay = BATCH_DELAY_MS + Math.floor((Math.random() - 0.5) * 150);
                        await new Promise(r => setTimeout(r, Math.max(100, delay)));
                    }
                }

                if (credited > 0) {
                    console.log(`[Game Time Booster] ✓ Accepted ${credited.toFixed(0)}h across ${selectedGames.length} games. Badges can take 24-48h to update.`);
                }
                return credited;
            } finally {
                isBoosting = false;
            }
        };

        let presenceTimer = setInterval(announce, 5 * 60 * 1000);
        const stop = () => {
            if (stopped) return;
            stopped = true;
            if (presenceTimer) {
                clearInterval(presenceTimer);
                presenceTimer = null;
            }
            for (const [key, fn] of Object.entries(original)) runStore[key] = fn;
            dispatcher.dispatch({
                type: "RUNNING_GAMES_CHANGE",
                added: [],
                removed: [activePresenceGame],
                games: withoutOurs(original.getRunningGames.call(runStore))
            });
            dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: null, pid, activity: null });
            delete window[LOCK];
            delete window.__cs2Presence;
            console.log("[Game Time Presence] Stopped and store restored.");
        };

        const instance = {
            stop,
            boost,
            game: activePresenceGame,
            get creditedHours() { return totalCreditedHours; }
        };
        window[LOCK] = instance;
        window.__cs2Presence = instance;
        window.addEventListener("pagehide", stop, { once: true });

        announce();
        console.log("[Game Time Presence] Active. Rich presence displayed: Playing Counter-Strike 2");
        console.log(`[Game Time Presence] Booster: submits ${TOTAL_TARGET_HOURS}h across ${GAMES_TO_SPREAD} games (${HOURS_PER_GAME}h each) via Discord REST.`);
        console.log(`[Game Time Presence] Manual boost: await window.__gameTimePresence.boost(${TOTAL_TARGET_HOURS}, ${GAMES_TO_SPREAD})`);
        console.log("[Game Time Presence] To stop: window.__gameTimePresence.stop()");

        if (AUTO_BOOST) {
            setTimeout(() => {
                boost(TOTAL_TARGET_HOURS, GAMES_TO_SPREAD).catch(err =>
                    console.warn(`[Game Time Booster] Auto-boost failed: ${err.message}`)
                );
            }, 1200);
        }
    } catch (err) {
        delete window[LOCK];
        delete window.__cs2Presence;
        console.error("[Game Time Presence]", err);
    }
})();
