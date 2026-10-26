(async () => {
    "use strict";

    const LOCK = "__multiGamePresence";
    const GAMES_CDN_URL = "https://cdn.discordapp.com/detectables/games.json";
    const MIN_CHANGE_MS = 23 * 60 * 1000;
    const MAX_CHANGE_MS = 38 * 60 * 1000;
    const AUTO_CLAIM = true;
    const AUTO_CLAIM_COUNT = 125; // Infinity = every win32 game in the CDN list
    const AUTO_CLAIM_HOURS = 1.5;
    const BATCH_GAMES = 5;
    const BATCH_DELAY_MS = 4000;
    const STAGGER_MINUTES = 25;

    const CLIENT_VERSION = "1.0.9253";
    const CLIENT_BUILD_NUMBER = 594031;
    const NATIVE_BUILD_NUMBER = 88414;
    const OS_VERSION = "10.0.26200";
    const MACHINE_GUID = "b5a79402-959c-4861-a579-2821dfbb3c2b";
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 " +
        "Electron/42.7.1 Safari/537.36";

    if (window[LOCK]) {
        console.warn("[Multi Game Presence] Already running. To stop: window.__multiGamePresence.stop()");
        return;
    }
    window[LOCK] = { loading: true };

    const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const isLinux = /Linux/i.test(navigator.userAgent);
    const basename = value => String(value ?? "").split(/[\\/]/).pop();
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
        webpackChunkdiscord_app.push([[Symbol("multi-game-presence")], {}, incoming => {
            if (Object.keys(incoming?.c ?? {}).length > Object.keys(req?.c ?? {}).length) req = incoming;
        }]);
        webpackChunkdiscord_app.pop();
        return req;
    }

    function collectExports(req) {
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

    function findStore(exports, name) {
        const origWarn = console.warn;
        try {
            console.warn = () => {};
            return exports.find(value => {
                try {
                    return value && typeof value === "object" &&
                        (value.getName?.() === name || value.__proto__?.constructor?.displayName === name);
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
        const exports = collectExports(req);
        const runStore = findStore(exports, "RunningGameStore");
        const dispatcher = findDispatcher(exports);
        if (!runStore || !dispatcher) throw new Error("RunningGameStore/Dispatcher was not found.");
        const detectableStore = findStore(exports, "DetectableGameStore");
        const authStore = findStore(exports, "AuthenticationStore");
        const userStore = findStore(exports, "UserStore");

        function parseGames(list) {
            const seen = new Set();
            const games = [];
            for (const raw of list ?? []) {
                const id = String(raw?.id ?? "");
                if (!/^\d+$/.test(id) || seen.has(id)) continue;
                const executables = Array.isArray(raw?.executables) ? raw.executables : [];
                const win = executables.find(entry => entry?.os === "win32" && entry?.name);
                if (!win) continue;
                const linux = executables.find(entry => entry?.os === "linux" && entry?.name);
                seen.add(id);
                games.push({
                    name: String(raw?.name ?? "Unknown"),
                    id,
                    win_exe: String(win.name).replace(/>/g, ""),
                    linux_exe: linux ? String(linux.name).replace(/>/g, "") : ""
                });
            }
            return games;
        }

        async function loadGames() {
            console.log("[Multi Game Presence] Loading detectable games from the Discord CDN...");
            try {
                const res = await fetch(GAMES_CDN_URL, { cache: "no-store" });
                if (!res.ok) throw new Error(`games.json returned ${res.status}`);
                const games = parseGames(await res.json());
                if (games.length) {
                    console.log(`[Multi Game Presence] Loaded ${games.length} win32 games from the CDN.`);
                    return games;
                }
            } catch (err) {
                console.warn(`[Multi Game Presence] CDN game list failed: ${err.message}`);
            }
            try {
                const games = parseGames(detectableStore?.getDetectableGames?.() ?? []);
                if (games.length) {
                    console.log(`[Multi Game Presence] Loaded ${games.length} win32 games from DetectableGameStore.`);
                    return games;
                }
            } catch (_) {}
            throw new Error("Could not load a detectable game list.");
        }

        const GAMES = await loadGames();
        if (GAMES.length < 100) throw new Error("Detectable game list is too small.");

        function getToken() {
            try {
                const token = authStore?.getToken?.();
                if (token && typeof token === "string") return token;
            } catch (_) {}
            for (const exp of exports) {
                try {
                    // Check _dispatchToken to avoid triggering Discord's i18n translation Proxy
                    if (exp && typeof exp === "object" && exp._dispatchToken && typeof exp.getToken === "function") {
                        const token = exp.getToken();
                        if (token && typeof token === "string") return token;
                    }
                } catch (_) {}
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

        let seq = 0;
        const nextSeq = () => ++seq;

        const buildSessionEvents = (game, durationMs, fingerprint, gameIndex = 0) => {
            const sessionId = uuid();
            const offsetMs = gameIndex * (STAGGER_MINUTES * 60 * 1000);
            const now = Date.now() - offsetMs;
            const start = Math.max(0, now - durationMs);
            const winExe = game.win_exe || `${game.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.exe`;

            const jitter = Math.floor(Math.random() * 450) + 120;
            const launchProps = {
                client_track_timestamp: start + jitter,
                client_heartbeat_session_id: heartbeatSession,
                event_sequence_number: nextSeq(),
                game: game.name,
                game_id: game.id,
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
                executable_path: winExe,
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
                        game_id: game.id,
                        game_name: game.name,
                        game_metadata: null,
                        game_executable: winExe,
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
                        game_id: game.id,
                        game_name: game.name,
                        game_metadata: null,
                        game_executable: winExe,
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
                    console.warn(`[Multi Game Presence] Rate limited (429). Retrying in ${waitSec.toFixed(1)}s...`);
                    await new Promise(r => setTimeout(r, Math.max(waitSec * 1000, 2000)));
                    return await postScienceEvents(events, currentAuth, retry + 1);
                }
                const text = await res.text().catch(() => "");
                console.warn(`[Multi Game Presence] Science request returned ${res.status}` +
                    (text ? `: ${text.slice(0, 200)}` : ""));
                return false;
            } catch (err) {
                if (retry < 2) {
                    await new Promise(r => setTimeout(r, 1500));
                    return await postScienceEvents(events, currentAuth, retry + 1);
                }
                throw err;
            }
        }

        const original = {};
        const patchable = [
            "getRunningGames", "getGameForPID", "getVisibleGame", "getVisibleRunningGames",
            "getCandidateGames", "getRunningDiscordApplicationIds"
        ];
        for (const key of patchable) {
            if (typeof runStore[key] === "function") original[key] = runStore[key];
        }
        if (!original.getRunningGames || !original.getGameForPID) {
            throw new Error("Required RunningGameStore methods were not found.");
        }

        const pid = 45000 + Math.floor(Math.random() * 10000);
        let index = Math.floor(Math.random() * GAMES.length);
        let current = null;
        let timer = null;
        let stopped = false;

        const buildGame = entry => {
            const exeName = isLinux
                ? basename(entry.linux_exe || entry.win_exe)
                : basename(entry.win_exe);
            const exePath = isLinux
                ? `/home/user/.local/share/Steam/steamapps/common/${entry.name}/${exeName}`
                : `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${entry.name}\\${exeName}`;
            return {
                id: entry.id,
                name: entry.name,
                pid,
                pidPath: [pid],
                processName: entry.name,
                start: Date.now(),
                exeName,
                exePath,
                cmdLine: exePath,
                executables: [{ os: isLinux ? "linux" : "win32", name: exeName, is_launcher: false }],
                windowHandle: 0,
                fullscreenType: 0,
                overlay: false,
                sandboxed: false,
                hidden: false,
                isLauncher: false
            };
        };

        const realGames = () => (original.getRunningGames.call(runStore) ?? [])
            .filter(game => game?.pid !== pid);
        runStore.getRunningGames = () => current ? [...realGames(), current] : realGames();
        runStore.getGameForPID = value => value === pid && current
            ? current
            : original.getGameForPID.call(runStore, value);
        if (original.getVisibleGame) {
            runStore.getVisibleGame = () => current ?? original.getVisibleGame.call(runStore);
        }
        if (original.getVisibleRunningGames) {
            runStore.getVisibleRunningGames = () => current
                ? [...(original.getVisibleRunningGames.call(runStore) ?? []).filter(game => game?.pid !== pid), current]
                : original.getVisibleRunningGames.call(runStore);
        }
        if (original.getCandidateGames) {
            runStore.getCandidateGames = () => current
                ? [...(original.getCandidateGames.call(runStore) ?? []).filter(game => game?.pid !== pid), current]
                : original.getCandidateGames.call(runStore);
        }
        if (original.getRunningDiscordApplicationIds) {
            runStore.getRunningDiscordApplicationIds = () => {
                const ids = (original.getRunningDiscordApplicationIds.call(runStore) ?? [])
                    .filter(id => !current || id !== current.id);
                return current?.id ? [...ids, current.id] : ids;
            };
        }

        const dispatchRemoval = game => {
            if (!game) return;
            dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", added: [], removed: [game], games: realGames() });
            dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: null, pid, activity: null });
        };

        const activate = entry => {
            const previous = current;
            if (previous) dispatchRemoval(previous);
            current = buildGame(entry);
            dispatcher.dispatch({
                type: "RUNNING_GAMES_CHANGE",
                added: [current],
                removed: [],
                games: runStore.getRunningGames()
            });
            dispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                socketId: null,
                pid,
                activity: {
                    name: current.name,
                    type: 0,
                    application_id: current.id,
                    details: null,
                    state: null,
                    timestamps: { start: current.start },
                    assets: null
                }
            });
            console.log(`[Multi Game Presence] ${index + 1}/${GAMES.length}: ${current.name} (App ID: ${current.id})`);
        };

        const scheduleNext = () => {
            const delay = MIN_CHANGE_MS + Math.floor(Math.random() * (MAX_CHANGE_MS - MIN_CHANGE_MS + 1));
            timer = setTimeout(() => {
                next();
                scheduleNext();
            }, delay);
            console.log(`[Multi Game Presence] Next transition in ${Math.round(delay / 1000)} seconds.`);
        };

        const next = () => {
            index = (index + 1) % GAMES.length;
            activate(GAMES[index]);
        };

        const CLAIMED_KEY = "__multiGamePresence_claimed_ids";
        function getClaimedSet() {
            try {
                const saved = JSON.parse(localStorage.getItem(CLAIMED_KEY) || "[]");
                return new Set(Array.isArray(saved) ? saved : []);
            } catch (_) {
                return new Set();
            }
        }
        function saveClaimedSet(set) {
            try {
                localStorage.setItem(CLAIMED_KEY, JSON.stringify(Array.from(set)));
            } catch (_) {}
        }

        let isClaiming = false;
        const claim = async (
            count = AUTO_CLAIM_COUNT,
            hours = AUTO_CLAIM_HOURS,
            delayMs = BATCH_DELAY_MS,
            batchSize = BATCH_GAMES
        ) => {
            if (stopped) return 0;
            if (isClaiming) {
                console.warn("[Multi Game Presence] Claim already running. Please wait for the current batch to complete.");
                return 0;
            }
            const total = Math.min(count, GAMES.length);
            const durationMs = Math.round(hours * 3600 * 1000);
            if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
                console.warn("[Multi Game Presence] Invalid claim count or hours.");
                return 0;
            }

            const claimedSet = getClaimedSet();
            const unusedGames = GAMES.filter(g => !claimedSet.has(g.id));
            const targetGames = (unusedGames.length >= total)
                ? unusedGames.slice(0, total)
                : [...unusedGames, ...GAMES.filter(g => claimedSet.has(g.id))].slice(0, total);

            console.log(`[Multi Game Presence] Claiming ${targetGames.length} games (${unusedGames.length} unused available, ${hours}h each, ${batchSize}/batch, ${delayMs}ms delay)...`);
            isClaiming = true;
            try {
                const currentAuth = await prepareAuth();
                if (stopped) return 0;
                console.log(`[Multi Game Presence] User ID: ${currentAuth.userId}`);
                console.log("[Multi Game Presence] ✓ Stable executable fingerprint ready.");

                let claimed = 0;
                for (let i = 0; i < targetGames.length; i += batchSize) {
                    if (stopped) {
                        console.warn("[Multi Game Presence] Claim stopped.");
                        break;
                    }
                    const chunk = targetGames.slice(i, i + batchSize);
                    const events = chunk.flatMap((game, idx) =>
                        buildSessionEvents(game, durationMs, currentAuth.fingerprint, i + idx)
                    );
                    let ok = false;
                    try {
                        ok = await postScienceEvents(events, currentAuth);
                    } catch (err) {
                        console.warn(`[Multi Game Presence] Batch at ${i} failed: ${err.message}`);
                    }
                    if (ok) {
                        claimed += chunk.length;
                        for (const g of chunk) claimedSet.add(g.id);
                        saveClaimedSet(claimedSet);
                        console.log(`[Multi Game Presence] Progress: ${claimed}/${targetGames.length} games accepted (Total unique claimed: ${claimedSet.size}).`);
                    } else {
                        console.warn(`[Multi Game Presence] Batch starting at index ${i} failed.`);
                    }
                    if (i + batchSize < targetGames.length && !stopped) {
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }
                }
                console.log(`[Multi Game Presence] Finished! ${claimed}/${targetGames.length} games accepted. Total unique claimed in history: ${claimedSet.size}`);
                return claimed;
            } finally {
                isClaiming = false;
            }
        };

        const stop = () => {
            if (stopped) return;
            stopped = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            const previous = current;
            current = null;
            for (const [key, fn] of Object.entries(original)) runStore[key] = fn;
            dispatchRemoval(previous);
            delete window[LOCK];
            console.log("[Multi Game Presence] Stopped and store restored.");
        };

        const resetClaimed = () => {
            localStorage.removeItem(CLAIMED_KEY);
            console.log("[Multi Game Presence] Claimed history reset.");
        };

        window[LOCK] = {
            stop,
            next,
            claim,
            resetClaimed,
            get games() { return GAMES.map(game => game.name); },
            get current() { return current?.name ?? null; },
            get currentGame() { return current; },
            get claimedCount() { return getClaimedSet().size; }
        };
        window.addEventListener("pagehide", stop, { once: true });

        activate(GAMES[index]);
        scheduleNext();
        console.log(`[Multi Game Presence] ${GAMES.length} games loaded.`);
        console.log("[Multi Game Presence] To stop: window.__multiGamePresence.stop()");
        if (AUTO_CLAIM) {
            console.log(`[Multi Game Presence] Auto claim: ` +
                `${AUTO_CLAIM_COUNT === Infinity ? "all" : AUTO_CLAIM_COUNT}/${GAMES.length} games.`);
            claim().catch(err => console.warn(`[Multi Game Presence] Auto claim failed: ${err.message}`));
        }
    } catch (err) {
        delete window[LOCK];
        console.error("[Multi Game Presence]", err);
    }
})();
