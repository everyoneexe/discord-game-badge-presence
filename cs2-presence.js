(async () => {
    "use strict";

    const LOCK = "__cs2Presence";
    if (window[LOCK]) {
        console.warn("[CS2 Presence] Already running. To stop: window.__cs2Presence.stop()");
        return;
    }
    window[LOCK] = { loading: true };

    const IS_LINUX = /Linux/i.test(navigator.userAgent);
    const GAME = Object.freeze(IS_LINUX ? {
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

    // Tek seferde 5.000 saat (Game Time rozet tavanı) basma ayarı
    const AUTO_BOOST = true;
    const AUTO_BOOST_HOURS = 5000; // Game Time rozetinin maksimum seviyesi (5.000 saat)

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
        webpackChunkdiscord_app.push([[Symbol("cs2-presence")], {}, r => {
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

        let seq = 0;
        const nextSeq = () => ++seq;

        const buildSessionEvents = (durationMs, fingerprint, sessionIndex = 0) => {
            const sessionId = uuid();
            const offsetMs = sessionIndex * (15 * 60 * 1000); // Seansları 15 dk aralıkla geçmişe yay
            const now = Date.now() - offsetMs;
            const start = Math.max(0, now - durationMs);
            const jitter = Math.floor(Math.random() * 450) + 120;

            const launchProps = {
                client_track_timestamp: start + jitter,
                client_heartbeat_session_id: heartbeatSession,
                event_sequence_number: nextSeq(),
                game: GAME.name,
                game_id: GAME.id,
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
                executable_path: GAME.win_exe,
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
                        game_id: GAME.id,
                        game_name: GAME.name,
                        game_metadata: null,
                        game_executable: GAME.win_exe,
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
                        game_id: GAME.id,
                        game_name: GAME.name,
                        game_metadata: null,
                        game_executable: GAME.win_exe,
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
                    console.warn(`[CS2 Presence] Rate limited (429). Retrying in ${waitSec.toFixed(1)}s...`);
                    await new Promise(r => setTimeout(r, Math.max(waitSec * 1000, 2000)));
                    return await postScienceEvents(events, currentAuth, retry + 1);
                }
                const text = await res.text().catch(() => "");
                console.warn(`[CS2 Presence] Science request returned ${res.status}` +
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

        // --- Rich Presence Motoru ---
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
        const game = {
            id: GAME.id,
            name: GAME.name,
            pid,
            pidPath: [pid],
            processName: GAME.name,
            start: startedAt,
            exeName: GAME.exeName,
            exePath: GAME.exePath,
            cmdLine: GAME.cmdLine,
            executables: [{ os: GAME.os, name: GAME.exeName, is_launcher: false }],
            windowHandle: 0,
            fullscreenType: 0,
            overlay: true,
            sandboxed: false,
            hidden: false,
            isLauncher: false
        };

        const withoutOurs = games => (games ?? []).filter(item => item?.pid !== pid);
        runStore.getRunningGames = () => [...withoutOurs(original.getRunningGames.call(runStore)), game];
        runStore.getGameForPID = value => value === pid ? game : original.getGameForPID.call(runStore, value);
        if (original.getVisibleGame) runStore.getVisibleGame = () => game;
        if (original.getVisibleRunningGames) {
            runStore.getVisibleRunningGames = () => [...withoutOurs(original.getVisibleRunningGames.call(runStore)), game];
        }
        if (original.getCandidateGames) {
            runStore.getCandidateGames = () => [...withoutOurs(original.getCandidateGames.call(runStore)), game];
        }
        if (original.getRunningDiscordApplicationIds) {
            runStore.getRunningDiscordApplicationIds = () => {
                const ids = original.getRunningDiscordApplicationIds.call(runStore) ?? [];
                return ids.includes(game.id) ? ids : [...ids, game.id];
            };
        }

        const announce = () => {
            dispatcher.dispatch({
                type: "RUNNING_GAMES_CHANGE",
                added: [game],
                removed: [],
                games: runStore.getRunningGames()
            });
            dispatcher.dispatch({
                type: "LOCAL_ACTIVITY_UPDATE",
                socketId: null,
                pid,
                activity: {
                    name: GAME.name,
                    type: 0,
                    application_id: GAME.id,
                    details: null,
                    state: null,
                    timestamps: { start: startedAt },
                    assets: null
                }
            });
        };

        // --- Saat Katlama / Boost Motoru ---
        let totalCreditedHours = 0;
        let isBoosting = false;
        let stopped = false;

        const boost = async (hours = AUTO_BOOST_HOURS) => {
            if (stopped) return 0;
            if (isBoosting) {
                console.warn("[CS2 Presence] Boost already in progress. Please wait.");
                return 0;
            }
            if (!Number.isFinite(hours) || hours <= 0) {
                console.warn("[CS2 Presence] Invalid hours.");
                return 0;
            }
            isBoosting = true;
            try {
                const currentAuth = await prepareAuth();
                if (stopped) return 0;

                const durationMs = Math.round(hours * 3600 * 1000);
                console.log(`[CS2 Presence] Claiming ${hours} hours for Counter-Strike 2 in a single verified session...`);

                const events = buildSessionEvents(durationMs, currentAuth.fingerprint);
                const ok = await postScienceEvents(events, currentAuth);
                if (ok) {
                    totalCreditedHours += hours;
                    console.log(`[CS2 Presence] ✓ SUCCESS! Credited ${hours} hours to Counter-Strike 2! (Total: ${totalCreditedHours}h)`);
                    console.log("[CS2 Presence] Discord backend will process and reflect on your Game Time badge.");
                    return hours;
                } else {
                    console.warn("[CS2 Presence] ✗ Failed to submit 5k hours to science endpoint.");
                    return 0;
                }
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
                removed: [game],
                games: withoutOurs(original.getRunningGames.call(runStore))
            });
            dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: null, pid, activity: null });
            delete window[LOCK];
            console.log("[CS2 Presence] Stopped and store restored.");
        };

        window[LOCK] = {
            stop,
            boost,
            game,
            get creditedHours() { return totalCreditedHours; }
        };
        window.addEventListener("pagehide", stop, { once: true });

        announce();
        console.log("[CS2 Presence] Active. Rich presence displayed: Playing Counter-Strike 2");
        console.log("[CS2 Presence] Single-shot booster ready. Default: 5,000 hours.");
        console.log("[CS2 Presence] Manual call: await window.__cs2Presence.boost(5000)");
        console.log("[CS2 Presence] To stop: window.__cs2Presence.stop()");

        if (AUTO_BOOST) {
            setTimeout(() => {
                boost(AUTO_BOOST_HOURS).catch(err => console.warn(`[CS2 Presence] Auto-boost failed: ${err.message}`));
            }, 1500);
        }
    } catch (err) {
        delete window[LOCK];
        console.error("[CS2 Presence]", err);
    }
})();
