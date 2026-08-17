(() => {
    "use strict";

    const LOCK = "__multiGamePresence";
    const MIN_CHANGE_MS = 23 * 60 * 1000;
    const MAX_CHANGE_MS = 38 * 60 * 1000;
    const GAMES = Object.freeze([
        "Counter-Strike 2", "Dota 2", "Team Fortress 2", "Half-Life 2", "Portal 2",
        "Left 4 Dead 2", "Apex Legends", "Fortnite", "VALORANT", "Overwatch 2",
        "Minecraft", "Terraria", "Stardew Valley", "Rust", "DayZ",
        "ARK: Survival Ascended", "Palworld", "PUBG: BATTLEGROUNDS", "Grand Theft Auto V", "Red Dead Redemption 2",
        "Cyberpunk 2077", "The Witcher 3: Wild Hunt", "Elden Ring", "Dark Souls III", "Sekiro: Shadows Die Twice",
        "Baldur's Gate 3", "Divinity: Original Sin 2", "Diablo IV", "Path of Exile", "Last Epoch",
        "World of Warcraft", "FINAL FANTASY XIV", "Guild Wars 2", "The Elder Scrolls Online", "Lost Ark",
        "Warframe", "Destiny 2", "Helldivers 2", "Deep Rock Galactic", "War Thunder",
        "World of Tanks", "World of Warships", "Tom Clancy's Rainbow Six Siege", "Escape from Tarkov", "Hunt: Showdown 1896",
        "Call of Duty", "Battlefield 2042", "Halo Infinite", "DOOM Eternal", "Quake Champions",
        "PAYDAY 2", "Ready or Not", "Insurgency: Sandstorm", "Squad", "Arma 3",
        "Foxhole", "Hell Let Loose", "Garry's Mod", "Among Us", "Fall Guys",
        "Rocket League", "EA SPORTS FC 26", "NBA 2K26", "Forza Horizon 5", "Assetto Corsa Competizione",
        "Euro Truck Simulator 2", "American Truck Simulator", "F1 26", "BeamNG.drive", "Need for Speed Unbound",
        "The Crew Motorfest", "Trackmania", "Cities: Skylines II", "Factorio", "Satisfactory",
        "RimWorld", "Oxygen Not Included", "Frostpunk 2", "Sid Meier's Civilization VI", "Age of Empires IV",
        "Total War: WARHAMMER III", "Crusader Kings III", "Europa Universalis IV", "Hearts of Iron IV", "Stellaris",
        "StarCraft II", "Warcraft III", "Command & Conquer Remastered Collection", "XCOM 2", "Into the Breach",
        "Hades II", "Dead Cells", "Hollow Knight", "Celeste", "Cuphead",
        "Ori and the Will of the Wisps", "The Binding of Isaac: Rebirth", "Vampire Survivors", "Risk of Rain 2", "Slay the Spire",
        "Balatro", "Dave the Diver", "Disco Elysium", "Undertale", "Deltarune",
        "Resident Evil 4", "Silent Hill 2", "Dead Space", "Alan Wake 2", "Control",
        "The Last of Us Part I", "God of War Ragnarök", "Horizon Forbidden West", "Ghost of Tsushima", "Marvel's Spider-Man 2",
        "Assassin's Creed Shadows", "Far Cry 6", "Death Stranding", "No Man's Sky", "Subnautica",
        "Sea of Thieves", "Monster Hunter Wilds", "Hogwarts Legacy", "Black Myth: Wukong", "METAL GEAR SOLID Δ: SNAKE EATER"
    ]);

    if (window[LOCK]?.stop) {
        console.warn("[Multi Game Presence] Zaten çalışıyor. Durdurmak için: window.__multiGamePresence.stop()");
        return;
    }
    if (GAMES.length < 100) throw new Error("[Multi Game Presence] Oyun listesi 100 kaydın altında.");

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
        return exports.find(value => {
            try {
                return value && typeof value === "object" &&
                    (value.getName?.() === name || value.__proto__?.constructor?.displayName === name);
            } catch (_) {
                return false;
            }
        });
    }

    function findDispatcher(exports) {
        return exports.find(value => value && typeof value.dispatch === "function" &&
            typeof value.subscribe === "function" && value._subscriptions);
    }

    const req = getWebpackRequire();
    if (!req?.c) throw new Error("[Multi Game Presence] Discord webpack kaydı bulunamadı.");
    const exports = collectExports(req);
    const runStore = findStore(exports, "RunningGameStore");
    const dispatcher = findDispatcher(exports);
    if (!runStore || !dispatcher) throw new Error("[Multi Game Presence] RunningGameStore/Dispatcher bulunamadı.");

    const original = {};
    const patchable = ["getRunningGames", "getGameForPID", "getVisibleGame", "getVisibleRunningGames", "getCandidateGames"];
    for (const key of patchable) {
        if (typeof runStore[key] === "function") original[key] = runStore[key];
    }
    if (!original.getRunningGames || !original.getGameForPID) {
        throw new Error("[Multi Game Presence] Gerekli RunningGameStore metotları bulunamadı.");
    }

    const pid = 45000 + Math.floor(Math.random() * 10000);
    let index = Math.floor(Math.random() * GAMES.length);
    let current = null;
    let timer = null;

    const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const buildGame = name => {
        const executable = /Linux/i.test(navigator.userAgent) ? slug(name) : `${slug(name)}.exe`;
        return {
            id: null,
            name,
            pid,
            pidPath: [pid],
            processName: name,
            start: Date.now(),
            exeName: executable,
            exePath: `/synthetic/games/${slug(name)}/${executable}`,
            cmdLine: `/synthetic/games/${slug(name)}/${executable}`,
            executables: [{ os: /Linux/i.test(navigator.userAgent) ? "linux" : "win32", name: executable, is_launcher: false }],
            windowHandle: 0,
            fullscreenType: 0,
            overlay: false,
            sandboxed: false,
            hidden: false,
            isLauncher: false
        };
    };

    const realGames = () => (original.getRunningGames.call(runStore) ?? []).filter(game => game?.pid !== pid);
    runStore.getRunningGames = () => current ? [...realGames(), current] : realGames();
    runStore.getGameForPID = value => value === pid && current ? current : original.getGameForPID.call(runStore, value);
    if (original.getVisibleGame) runStore.getVisibleGame = () => current ?? original.getVisibleGame.call(runStore);
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

    const dispatchRemoval = game => {
        if (!game) return;
        dispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", added: [], removed: [game], games: realGames() });
        dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: null, pid, activity: null });
    };

    const activate = name => {
        const previous = current;
        if (previous) dispatchRemoval(previous);
        current = buildGame(name);
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
                details: null,
                state: null,
                timestamps: { start: current.start },
                assets: null
            }
        });
        console.log(`[Multi Game Presence] ${index + 1}/${GAMES.length}: ${current.name}`);
    };

    const scheduleNext = () => {
        const delay = MIN_CHANGE_MS + Math.floor(Math.random() * (MAX_CHANGE_MS - MIN_CHANGE_MS + 1));
        timer = setTimeout(() => {
            next();
            scheduleNext();
        }, delay);
        console.log(`[Multi Game Presence] Sonraki geçiş yaklaşık ${(delay / 60000).toFixed(1)} dakika sonra.`);
    };

    const next = () => {
        index = (index + 1) % GAMES.length;
        activate(GAMES[index]);
    };

    const stop = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
        const previous = current;
        current = null;
        for (const [key, fn] of Object.entries(original)) runStore[key] = fn;
        dispatchRemoval(previous);
        delete window[LOCK];
        console.log("[Multi Game Presence] Durduruldu ve store geri yüklendi.");
    };

    window[LOCK] = { stop, next, games: GAMES, get current() { return current?.name ?? null; } };
    window.addEventListener("pagehide", stop, { once: true });
    activate(GAMES[index]);
    scheduleNext();
    console.log(`[Multi Game Presence] ${GAMES.length} oyun yüklendi. Elle geçiş: window.__multiGamePresence.next()`);
})();
