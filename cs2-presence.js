(() => {
    "use strict";

    const LOCK = "__cs2Presence";
    if (window[LOCK]?.stop) {
        console.warn("[CS2 Presence] Zaten çalışıyor. Durdurmak için: window.__cs2Presence.stop()");
        return;
    }

    const IS_LINUX = /Linux/i.test(navigator.userAgent);
    const GAME = Object.freeze(IS_LINUX ? {
        name: "Counter-Strike 2",
        exeName: "cs2",
        exePath: "/home/user/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2",
        cmdLine: "/home/user/.local/share/Steam/steamapps/common/Counter-Strike Global Offensive/game/bin/linuxsteamrt64/cs2",
        os: "linux"
    } : {
        name: "Counter-Strike 2",
        exeName: "cs2.exe",
        exePath: "c:/program files (x86)/steam/steamapps/common/counter-strike global offensive/game/bin/win64/cs2.exe",
        cmdLine: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe",
        os: "win32"
    });

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
        return exports.find(value => {
            try {
                return value && typeof value === "object" &&
                    (value.getName?.() === displayName || value.__proto__?.constructor?.displayName === displayName);
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
    if (!req?.c) throw new Error("[CS2 Presence] Discord webpack kaydı bulunamadı.");

    const exports = exportsFrom(req);
    const runStore = findStore(exports, "RunningGameStore");
    const dispatcher = findDispatcher(exports);
    if (!runStore || !dispatcher) throw new Error("[CS2 Presence] RunningGameStore/Dispatcher bulunamadı; Discord sürümü uyumsuz.");

    const original = {};
    const patchable = [
        "getRunningGames", "getGameForPID", "getVisibleGame", "getVisibleRunningGames",
        "getCandidateGames", "getRunningDiscordApplicationIds"
    ];
    for (const key of patchable) {
        if (typeof runStore[key] === "function") original[key] = runStore[key];
    }
    if (!original.getRunningGames || !original.getGameForPID) {
        throw new Error("[CS2 Presence] Gerekli RunningGameStore metotları yok.");
    }

    const pid = 40000 + Math.floor(Math.random() * 20000);
    const startedAt = Date.now();
    const game = {
        id: null,
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
                details: null,
                state: null,
                timestamps: { start: startedAt },
                assets: null
            }
        });
    };

    let timer = setInterval(announce, 5 * 60 * 1000);
    const stop = () => {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
        for (const [key, fn] of Object.entries(original)) runStore[key] = fn;
        dispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            added: [],
            removed: [game],
            games: withoutOurs(original.getRunningGames.call(runStore))
        });
        dispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: null, pid, activity: null });
        delete window[LOCK];
        console.log("[CS2 Presence] Durduruldu ve store geri yüklendi.");
    };

    window[LOCK] = { stop, game };
    window.addEventListener("pagehide", stop, { once: true });
    announce();
    console.log("[CS2 Presence] Etkin. Durdurmak için: window.__cs2Presence.stop()");
})();
