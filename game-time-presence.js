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
        win_exe: "cs2.exe",
        exeName: "cs2",
        exePath: "/home/user/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2",
        cmdLine: "/home/user/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2",
        os: "linux"
    } : {
        id: "1158877933042143272",
        name: "Counter-Strike 2",
        win_exe: "cs2.exe",
        exeName: "cs2.exe",
        exePath: "c:/program files (x86)/steam/steamapps/common/counter-strike global offensive/game/bin/win64/cs2.exe",
        cmdLine: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe",
        os: "win32"
    });

    // Automatic 5,000-hour (Game Time max badge ceiling) boost configuration
    // Because Discord drops telemetry older than 7 days, 5,000 hours are safely distributed across
    // 40 distinct verified games at 125 hours (~5 days) each, ensuring complete server acceptance.
    const AUTO_BOOST = true;
    const TOTAL_TARGET_HOURS = 5000;
    const GAMES_TO_SPREAD = 40; // 40 games * 125 hours = 5,000 hours
    const HOURS_PER_GAME = TOTAL_TARGET_HOURS / GAMES_TO_SPREAD; // 125 hours (~5 days)
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 600;

    const CDN_GAMES_URL = "https://cdn.discordapp.com/detectables/games.json";
    const CLIENT_VERSION = "1.0.9253";
    const CLIENT_BUILD_NUMBER = 594031;
    const NATIVE_BUILD_NUMBER = 88414;
    const OS_VERSION = "10.0.26200";
    const MACHINE_GUID = "b5a79402-959c-4861-a579-2821dfbb3c2b";
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 " +
        "Electron/42.7.1 Safari/537.36";

    const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const b64utf8 = value => {
        const bytes = new TextEncoder().encode(value);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    };
    const sha256 = async value => new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    );

    function getWebpackRequire() {
        if (window.Vencord?.Webpack?.wreq?.c) return window.Vencord.Webpack.wreq;
        if (typeof webpackChunkdiscord_app === "undefined") return null;

        let req;
        webpackChunkdiscord_app.push([[Symbol("game-time-presence")], {}, r => {
            if (Object.keys(r?.c ?? {}).length > Object.keys(req?.c ?? {}).length) req = r;
        }]);
        webpackChunkdiscord_app.pop();
        return req;
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

        const exports = exportsFrom(req);
        const runStore = findStore(exports, "RunningGameStore");
        const dispatcher = findDispatcher(exports);
        if (!runStore || !dispatcher) throw new Error("RunningGameStore/Dispatcher was not found; incompatible Discord version.");
        const authStore = findStore(exports, "AuthenticationStore");
        const userStore = findStore(exports, "UserStore");

        function getToken() {
            try {
                const token = authStore?.getToken?.();
                if (token && typeof token === "string") return token;
            } catch (_) {}
            const origWarn = console.warn;
            try {
                console.warn = () => {};
                for (const exp of exports) {
                    try {
                        if (exp && typeof exp.getToken === "function" && exp.getName?.() === "AuthenticationStore") {
                            const token = exp.getToken();
                            if (token && typeof token === "string") return token;
                        }
                    } catch (_) {}
                }
            } finally {
                console.warn = origWarn;
            }
            return null;
        }

        function getUserId(token) {
            try {
                const uid = userStore?.getCurrentUser?.()?.id || authStore?.getId?.();
                if (uid && /^\d+$/.test(uid)) return String(uid);
            } catch (_) {}
            try {
                const part = String(token ?? "").split(".")[0];
                if (part && part !== "mfa") {
                    const pad = "=".repeat((4 - (part.length % 4)) % 4);
                    const decoded = atob(part + pad);
                    if (/^\d+$/.test(decoded)) return decoded;
                }
            } catch (_) {}
            return "";
        }

        async function generateFingerprint(userId) {
            const out = new Uint8Array(146);
            out[0] = 1;
            out[1] = 3;
            const view = new DataView(out.buffer);
            view.setUint32(2, 45829120, true);
            view.setUint32(6, 0, true);
            view.setUint32(10, 1700000000, true);
            view.setUint32(14, 50000000, true);
            out.set(await sha256("header"), 18);
            out.set(await sha256(MACHINE_GUID + userId), 50);
            out.set(await sha256("sections"), 82);
            out.set(await sha256("cert"), 114);
            const key = await sha256(userId + "https://discord.com/careers");
            for (let i = 1; i < out.length; i++) out[i] ^= key[(i - 1) & 31];
            let binary = "";
            for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
            return btoa(binary);
        }

        function buildSuperProps(launchSignature, heartbeatSession, clientLaunchId) {
            return b64utf8(JSON.stringify({
                os: "Windows",
                browser: "Discord Client",
                release_channel: "stable",
                client_version: CLIENT_VERSION,
                os_version: OS_VERSION,
                os_arch: "x64",
                app_arch: "x64",
                system_locale: "en-US",
                has_client_mods: false,
                browser_user_agent: USER_AGENT,
                browser_version: "42.7.1",
                os_sdk_version: "26200",
                client_build_number: CLIENT_BUILD_NUMBER,
                native_build_number: NATIVE_BUILD_NUMBER,
                client_event_source: null,
                client_app_state: "focused",
                client_launch_id: clientLaunchId,
                launch_signature: launchSignature,
                client_heartbeat_session_id: heartbeatSession
            }));
        }

        const launchSignature = uuid();
        const heartbeatSession = uuid();
        const clientLaunchId = uuid();
        const superProps = buildSuperProps(launchSignature, heartbeatSession, clientLaunchId);
        let auth = null;

        async function getAnalyticsToken(token) {
            try {
                const res = await fetch("/api/v9/users/@me?with_analytics_token=true", {
                    headers: {
                        "authorization": token,
                        "x-super-properties": superProps
                    }
                });
                if (!res.ok) return null;
                const data = await res.json();
                return data.analytics_token ?? null;
            } catch (_) {
                return null;
            }
        }

        async function prepareAuth() {
            if (auth) return auth;
            const token = getToken();
            if (!token) throw new Error("Discord token could not be found.");
            const userId = getUserId(token);
            if (!userId) throw new Error("Discord user ID could not be decoded.");
            const analyticsToken = await getAnalyticsToken(token);
            if (!analyticsToken) throw new Error("analytics_token could not be retrieved.");
            const fingerprint = await generateFingerprint(userId);
            auth = { token, userId, analyticsToken, fingerprint, superProps };
            return auth;
        }

        async function loadDetectableGames() {
            try {
                const res = await fetch(CDN_GAMES_URL);
                if (res.ok) {
                    const raw = await res.json();
                    const list = [];
                    const seen = new Set();
                    for (const item of raw) {
                        const id = String(item?.id ?? "");
                        if (!id || seen.has(id)) continue;
                        const winExe = item?.executables?.find(e => e?.os === "win32" && e?.name)?.name;
                        if (!winExe) continue;
                        seen.add(id);
                        list.push({
                            id,
                            name: item.name,
                            exe: winExe.replace(/^>/, "")
                        });
                    }
                    if (list.length > 0) return list;
                }
            } catch (_) {}
            return [
                { id: PRIMARY_GAME.id, name: PRIMARY_GAME.name, exe: PRIMARY_GAME.win_exe },
                { id: "733391060934070334", name: "Among Us", exe: "Among Us.exe" },
                { id: "356869127241826314", name: "Grand Theft Auto V", exe: "GTA5.exe" },
                { id: "426249774406238210", name: "Apex Legends", exe: "r5apex.exe" },
                { id: "403164998249840640", name: "PUBG: BATTLEGROUNDS", exe: "TslGame.exe" },
                { id: "417935350901768193", name: "Tom Clancy's Rainbow Six Siege", exe: "RainbowSix.exe" }
            ];
        }

        let seq = 0;
        const nextSeq = () => ++seq;

        const buildSessionEvents = (gameEntry, durationMs, fingerprint, sessionIndex = 0) => {
            const sessionId = uuid();
            const offsetMs = sessionIndex * (20 * 60 * 1000);
            const now = Date.now() - offsetMs;
            const start = Math.max(0, now - durationMs);
            const jitter = Math.floor(Math.random() * 450) + 120;

            const launchProps = {
                client_track_timestamp: start + jitter,
                client_heartbeat_session_id: heartbeatSession,
                event_sequence_number: nextSeq(),
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

            return [
                {
                    type: "running_game_heartbeat",
                    properties: {
                        client_track_timestamp: start,
                        client_heartbeat_session_id: heartbeatSession,
                        event_sequence_number: nextSeq(),
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
                        event_sequence_number: nextSeq(),
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
        };

        async function postScienceEvents(events, currentAuth, retry = 0) {
            try {
                const res = await fetch("/api/v9/science", {
                    method: "POST",
                    headers: {
                        "accept": "*/*",
                        "accept-language": "en-US",
                        "authorization": currentAuth.token,
                        "content-type": "application/json",
                        "origin": "https://discord.com",
                        "referer": "https://discord.com/channels/@me",
                        "x-super-properties": currentAuth.superProps
                    },
                    referrer: "https://discord.com/channels/@me",
                    body: JSON.stringify({ token: currentAuth.analyticsToken, events })
                });
                if (res.status === 204 || res.status === 200) return true;
                if (res.status === 429 && retry < 3) {
                    const retryHeader = res.headers.get("retry-after");
                    const waitSec = retryHeader ? parseFloat(retryHeader) : 2.5;
                    console.warn(`[Game Time Booster] Rate limited (429). Retrying in ${waitSec.toFixed(1)}s...`);
                    await new Promise(r => setTimeout(r, Math.max(waitSec * 1000, 2000)));
                    return await postScienceEvents(events, currentAuth, retry + 1);
                }
                return false;
            } catch (err) {
                if (retry < 2) {
                    await new Promise(r => setTimeout(r, 1500));
                    return await postScienceEvents(events, currentAuth, retry + 1);
                }
                throw err;
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

        // --- Safe Window Playtime Booster ---
        // Distributes 5,000 hours across 40 verified games (125 hours / ~5 days each)
        // to stay within Discord's 7-day analytics ingestion window and avoid ClickHouse drops.
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
                console.log("[Game Time Booster] Fetching verified game catalog from Discord CDN...");
                const allGames = await loadDetectableGames();
                const selectedGames = allGames.slice(0, Math.min(gameCount, allGames.length));
                const hoursPerGame = targetTotalHours / selectedGames.length;
                const durationMs = Math.round(hoursPerGame * 3600 * 1000);

                console.log(`[Game Time Booster] Spreading ${targetTotalHours}h across ${selectedGames.length} verified games (~${hoursPerGame.toFixed(1)}h / ~${(hoursPerGame/24).toFixed(1)} days per game)...`);
                console.log("[Game Time Booster] This fits within Discord's safe 7-day analytics ingestion window!");

                const currentAuth = await prepareAuth();
                if (stopped) return 0;

                let credited = 0;
                for (let i = 0; i < selectedGames.length; i += BATCH_SIZE) {
                    if (stopped) break;
                    const chunk = selectedGames.slice(i, i + BATCH_SIZE);
                    const events = chunk.flatMap((game, idx) =>
                        buildSessionEvents(game, durationMs, currentAuth.fingerprint, i + idx)
                    );

                    const ok = await postScienceEvents(events, currentAuth);
                    if (ok) {
                        const batchHours = chunk.length * hoursPerGame;
                        credited += batchHours;
                        totalCreditedHours += batchHours;
                        console.log(`[Game Time Booster] Progress: Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(selectedGames.length / BATCH_SIZE)} accepted (+${batchHours.toFixed(0)}h, Total: ${totalCreditedHours.toFixed(0)}h / ${targetTotalHours}h)`);
                    } else {
                        console.warn(`[Game Time Booster] Batch starting at index ${i} failed.`);
                    }

                    if (i + BATCH_SIZE < selectedGames.length && !stopped) {
                        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
                    }
                }

                if (credited > 0) {
                    console.log(`[Game Time Booster] ✓ SUCCESS! Credited ${credited.toFixed(0)} hours across ${selectedGames.length} games to Discord backend!`);
                    console.log("[Game Time Booster] Telemetry events accepted by Discord science endpoint.");
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
        console.log(`[Game Time Presence] Safe Ingestion Booster: Spreads 5,000h across 40 games (~5 days each).`);
        console.log("[Game Time Presence] Manual boost: await window.__gameTimePresence.boost(5000)");
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
