(async () => {
    "use strict";

    if (typeof webpackChunkdiscord_app === "undefined") {
        console.error("[Game Time] Discord desktop client required.");
        return;
    }

    const INSTANCE_KEY = "__gameTimePresence";
    const previous = window[INSTANCE_KEY];
    if (previous?.stop) {
        console.warn("[Game Time] Replacing the previous instance.");
        try { previous.stop(); } catch (_) {}
    }
    window[INSTANCE_KEY] = { loading: true };

    const CONFIG = Object.freeze({
        totalHours: 6000,
        games: 250,
        batchSize: 25,
        delayMs: 450,
        wobble: false,
        dryRun: false
    });

    const CATALOG_URL = "https://cdn.discordapp.com/detectables/games.json";

    const uuid = () => crypto.randomUUID();
    const sha256 = async value => new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    );
    const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));

    function webpackRequire() {
        const requireFn = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
        webpackChunkdiscord_app.pop();
        return requireFn;
    }

    const HTTP_METHODS = ["get", "post", "del"];

    function isHttpClient(candidate) {
        return candidate != null && HTTP_METHODS.every(method => typeof candidate[method] === "function");
    }

    function exportedValues(value) {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return [];
        return [value, value.default, ...Object.values(value)];
    }

    function findHttpClient(requireFn) {
        for (const [id, factory] of Object.entries(requireFn?.m ?? {})) {
            let source = "";
            try {
                source = typeof factory === "function" ? factory.toString() : "";
            } catch (_) {}
            if (!source.includes("HTTPUtils")) continue;
            try {
                const client = exportedValues(requireFn(id)).find(isHttpClient);
                if (client) return client;
            } catch (_) {}
        }
        for (const cached of Object.values(requireFn?.c ?? {})) {
            try {
                const client = exportedValues(cached?.exports).find(isHttpClient);
                if (client) return client;
            } catch (_) {}
        }
        return null;
    }

    async function fingerprintFor(userId) {
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

        for (let i = 1; i < binary.length; i++) {
            binary[i] ^= mask[(i - 1) & 31];
        }

        let str = "";
        for (let i = 0; i < binary.length; i++) str += String.fromCharCode(binary[i]);
        return btoa(str);
    }

    function normalizeGame(app) {
        if (app?.id == null) return null;
        const winExe = app?.executables?.find(entry => entry?.os === "win32" && entry?.name);
        const exeName = winExe
            ? winExe.name.replace(/^>/, "")
            : (!app.executables || app.executables.length === 0)
                ? `${(app.name || "game").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "game"}.exe`
                : null;
        if (!exeName) return null;
        return {
            id: String(app.id),
            name: app?.name ?? "Unknown",
            exe: exeName
        };
    }

    function shuffle(items) {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    }

    function sessionEvents(game, baseMs, fingerprint, state) {
        const drift = CONFIG.wobble ? 1 + (Math.random() * 0.06 - 0.03) : 1;
        const durationMs = Math.max(360000, Math.round(baseMs * drift));
        const sessionId = uuid();
        const now = Date.now();
        const start = Math.max(0, now - durationMs);

        const launch = {
            client_track_timestamp: now,
            client_heartbeat_session_id: state.heartbeat,
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
            executable_path: game.exe,
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
            launch_signature: state.signature,
            client_rtc_state: null,
            client_app_state: "focused",
            client_send_timestamp: now
        };

        const events = [
            {
                type: "running_game_heartbeat",
                properties: {
                    client_track_timestamp: start,
                    client_heartbeat_session_id: state.heartbeat,
                    game_id: game.id,
                    game_name: game.name,
                    game_metadata: null,
                    game_executable: game.exe,
                    game_detection_enabled: true,
                    initial_heartbeat: true,
                    final_heartbeat: false,
                    game_session_id: sessionId,
                    duration_tracked_ms: 0,
                    rtc_connection_id: null,
                    media_session_id: null,
                    launch_signature: state.signature,
                    client_app_state: "focused",
                    client_send_timestamp: start
                }
            },
            { type: "launch_game", properties: launch },
            {
                type: "running_game_heartbeat",
                properties: {
                    client_track_timestamp: now,
                    client_heartbeat_session_id: state.heartbeat,
                    game_id: game.id,
                    game_name: game.name,
                    game_metadata: null,
                    game_executable: game.exe,
                    game_detection_enabled: true,
                    initial_heartbeat: false,
                    final_heartbeat: true,
                    game_session_id: sessionId,
                    duration_tracked_ms: durationMs,
                    rtc_connection_id: null,
                    media_session_id: null,
                    launch_signature: state.signature,
                    client_app_state: "focused",
                    client_send_timestamp: now
                }
            }
        ];

        for (const event of events) {
            event.properties.event_sequence_number = ++state.sequence;
        }
        return { events, hours: durationMs / 3600000 };
    }

    async function getAuthContext(client) {
        if (!client) throw new Error("Discord's internal HTTP client could not be located.");
        const response = await client.get({ url: "/users/@me", query: { with_analytics_token: true } });
        const profile = response?.body ?? {};
        const analyticsToken = profile.analytics_token;
        const userId = profile.id == null ? "" : String(profile.id);
        const username = profile.username || "user";
        if (!analyticsToken) throw new Error("analytics_token is missing from this session.");
        if (!/^\d+$/.test(userId)) throw new Error("Discord user ID could not be resolved.");
        return {
            analyticsToken,
            username,
            fingerprint: await fingerprintFor(userId)
        };
    }

    async function getCatalog(client) {
        let apps = null;
        try {
            const response = await client?.get({ url: "/applications/detectable" });
            const payload = response?.body;
            apps = Array.isArray(payload) ? payload : payload?.applications;
        } catch (_) {}
        if (!Array.isArray(apps)) {
            try {
                const response = await fetch(CATALOG_URL);
                if (response.ok) apps = await response.json();
            } catch (_) {}
        }
        if (!Array.isArray(apps)) throw new Error("The detectable-game catalog is unavailable.");

        const unique = new Map();
        for (const app of apps) {
            const game = normalizeGame(app);
            if (game && !unique.has(game.id)) unique.set(game.id, game);
        }
        if (unique.size === 0) throw new Error("No detectable games were found.");
        return [...unique.values()];
    }

    async function sendBatch(events, context) {
        if (CONFIG.dryRun) return true;
        try {
            // The client attaches auth and super-properties headers.
            const response = await context.client.post({
                url: "/science",
                body: { token: context.analyticsToken, events }
            });
            if (response?.ok || response?.status === 200 || response?.status === 204) return true;
            if (response?.status === 429) {
                console.warn("[Game Time] Rate limited; cooling down 5s.");
                await wait(5);
            }
            return false;
        } catch (error) {
            const status = error?.status ?? error?.statusCode;
            if (status === 429) {
                console.warn("[Game Time] Rate limited; cooling down 5s.");
                await wait(5);
            }
            return false;
        }
    }

    const state = {
        heartbeat: uuid(),
        signature: uuid(),
        sequence: 0
    };

    let credited = 0;
    let running = false;
    let stopped = false;

    async function boost(totalHours = CONFIG.totalHours, gameCount = CONFIG.games) {
        if (stopped) return 0;
        if (running) {
            console.warn("[Game Time] A boost is already running.");
            return 0;
        }
        if (!Number.isFinite(totalHours) || totalHours <= 0) {
            console.warn("[Game Time] Invalid hour target.");
            return 0;
        }
        running = true;
        try {
            const requireFn = webpackRequire();
            if (!requireFn?.c) throw new Error("Discord's webpack registry was not found.");
            const client = findHttpClient(requireFn);
            if (!client) throw new Error("Discord's internal HTTP client could not be located.");

            console.log("[Game Time] Loading the detectable-game catalog...");
            const catalog = shuffle(await getCatalog(client));
            const selected = catalog.slice(0, Math.min(gameCount, catalog.length));
            const hoursPerGame = totalHours / selected.length;
            const baseDurationMs = Math.round(hoursPerGame * 3600 * 1000);

            const context = { ...(await getAuthContext(client)), client };
            console.log(`[Game Time] Connected as ${context.username} | target: ${totalHours}h across ${selected.length} games (~${hoursPerGame.toFixed(1)}h/game)`);
            if (CONFIG.dryRun) console.warn("[Game Time] Dry-run mode is ON — no data will be sent.");
            if (stopped) return 0;

            let forgedCount = 0;
            const totalBatches = Math.ceil(selected.length / CONFIG.batchSize);

            for (let offset = 0; offset < selected.length; offset += CONFIG.batchSize) {
                if (stopped) break;
                const chunk = selected.slice(offset, offset + CONFIG.batchSize);
                const allEvents = [];
                let chunkHours = 0;

                for (const game of chunk) {
                    const result = sessionEvents(game, baseDurationMs, context.fingerprint, state);
                    allEvents.push(...result.events);
                    chunkHours += result.hours;
                }

                const batchNum = Math.floor(offset / CONFIG.batchSize) + 1;
                const accepted = await sendBatch(allEvents, context);

                if (accepted) {
                    forgedCount += chunk.length;
                    credited += chunkHours;
                    const tag = CONFIG.dryRun ? "[dry-run] " : "";
                    console.log(`[Game Time] ${tag}Batch ${batchNum}/${totalBatches} accepted (+${chunkHours.toFixed(1)}h, total ${credited.toFixed(0)}h)`);
                } else {
                    console.warn(`[Game Time] Batch ${batchNum}/${totalBatches} was rejected.`);
                }

                if (offset + CONFIG.batchSize < selected.length && !stopped) {
                    const jitter = CONFIG.delayMs + Math.floor((Math.random() - 0.5) * 150);
                    await wait(Math.max(100, jitter) / 1000);
                }
            }

            if (credited > 0) {
                console.log(`[Game Time] Done: ${forgedCount}/${selected.length} games | ${credited.toFixed(0)}h accepted. Badge updates may take 24-48h.`);
            }
            return credited;
        } finally {
            running = false;
        }
    }

    function stop() {
        if (stopped) return;
        stopped = true;
        delete window[INSTANCE_KEY];
        console.log("[Game Time] Stopped.");
    }

    window[INSTANCE_KEY] = { boost, stop, get creditedHours() { return credited; } };
    window.addEventListener("pagehide", stop, { once: true });

    console.log("[Game Time] Ready. Auto-boost is starting...");
    console.log(`[Game Time] Manual: await window.__gameTimePresence.boost(${CONFIG.totalHours}, ${CONFIG.games})`);
    console.log("[Game Time] Stop: window.__gameTimePresence.stop()");

    setTimeout(() => {
        boost(CONFIG.totalHours, CONFIG.games).catch(error =>
            console.warn(`[Game Time] Boost failed: ${error.message}`)
        );
    }, 1200);
})();
