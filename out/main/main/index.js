"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/main/index.ts - DomeOS AI main process
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_stream_1 = __importDefault(require("node:stream"));
// the background video is streamed through this private scheme, so CSP stays strict
// and no file:// or blob: access has to be granted to the page
electron_1.protocol.registerSchemesAsPrivileged([{ scheme: 'domeos-bg', privileges: { secure: true, stream: true } }]);
const node_os_1 = __importDefault(require("node:os"));
const config_1 = require("./config");
const providers_1 = require("./providers");
const registry_1 = require("./registry");
const media_1 = require("./media");
const background_1 = require("./background");
const tts_1 = require("./tts");
const controller_1 = require("./controller");
const persona_1 = require("./persona");
const agent_1 = require("./agent");
const tools_1 = require("./tools");
const store_1 = require("./store");
const quickbar_1 = require("./quickbar");
const selftest_1 = require("./selftest");
const traytext_1 = require("./traytext");
const voice_1 = require("./voice");
const isDev = !!process.env.DOMEOS_DEV;
const devUrl = isDev ? 'http://127.0.0.1:5173' : null;
let cfg = (0, config_1.defaultConfig)();
let mainWindow = null;
let tray = null;
let quick = null;
let media = null;
let quitting = false;
const running = new Map();
/** in-flight speech runs, keyed by the renderer's token, so "stop" can abort them */
const ttsRuns = new Map();
/** true while the orb is capturing: dictation is only forwarded during a session */
let voiceSession = false;
/** the helper reported READY, i.e. a microphone is really open */
let voiceReady = false;
/** true once the wake phrase has been heard in this run */
let voiceWoke = false;
/** pending "may I run this?" questions, keyed by `${streamId}:${callId}` */
const approvals = new Map();
let streamSeq = 0;
/** bumped whenever a new quick command starts, so stale events are dropped */
let quickSeq = 0;
/** Tray / notification strings, resolved from the configured language on every use. */
let l10n = (0, traytext_1.trayT)('auto');
function refreshL10n() {
    l10n = (0, traytext_1.trayT)(cfg.language);
}
const argv = process.argv.slice(1);
const hasFlag = (name) => argv.some((a) => a === name || a.startsWith(`${name}=`));
const flagValue = (name) => {
    const hit = argv.find((a) => a.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : undefined;
};
// ---------------------------------------------------------------- paths
const iconPath = (file) => node_path_1.default.join(__dirname, '..', '..', '..', 'assets', file);
function appIcon() {
    const ico = iconPath('icon.ico');
    const png = iconPath('icon-256.png');
    const chosen = node_fs_1.default.existsSync(ico) ? ico : png;
    const img = electron_1.nativeImage.createFromPath(chosen);
    return img.isEmpty() ? undefined : img;
}
// ---------------------------------------------------------------- theme
function resolveTheme() {
    if (cfg.theme === 'light')
        return { dark: false, source: 'user' };
    if (cfg.theme === 'dark')
        return { dark: true, source: 'user' };
    return { dark: electron_1.nativeTheme.shouldUseDarkColors, source: 'system' };
}
let lastThemeKey = '';
function broadcastTheme(force = false) {
    const t = resolveTheme();
    const key = `${t.dark}|${t.source}`;
    if (!force && key === lastThemeKey)
        return;
    lastThemeKey = key;
    electron_1.nativeTheme.themeSource = cfg.theme === 'auto' ? 'system' : cfg.theme;
    if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('theme:changed', t);
    quick?.notifyTheme();
}
// ---------------------------------------------------------------- window
function createWindow() {
    // never open bigger than most of the screen: on a 1080p display a 1180x780 window leaves
    // nothing around it, and the settings drawer then swallows the conversation
    const wa = electron_1.screen.getPrimaryDisplay().workArea;
    const width = Math.min(cfg.winW, Math.round(wa.width * 0.86), wa.width - 80);
    const height = Math.min(cfg.winH, Math.round(wa.height * 0.88), wa.height - 80);
    const x = cfg.winX > 0 && cfg.winX + width <= wa.x + wa.width ? cfg.winX : Math.round(wa.x + (wa.width - width) / 2);
    const y = cfg.winY > 0 && cfg.winY + height <= wa.y + wa.height ? cfg.winY : Math.round(wa.y + (wa.height - height) / 2);
    mainWindow = new electron_1.BrowserWindow({
        x, y, width, height,
        minWidth: 720,
        minHeight: 520,
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: resolveTheme().dark ? '#080b13' : '#f5f7fc',
        icon: appIcon(),
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // the settings sheet is an iframe inside this window, and it talks to the app
            // through the same preload bridge, so the bridge has to reach sub-frames too
            nodeIntegrationInSubFrames: true,
            sandbox: false,
            spellcheck: false,
        },
    });
    if (devUrl)
        mainWindow.loadURL(devUrl);
    else {
        const q = new URLSearchParams();
        const section = flagValue('--opensettings');
        if (section)
            q.set('opensettings', section === 'true' ? 'orb' : section);
        mainWindow.loadFile(node_path_1.default.join(__dirname, '..', '..', 'renderer', 'index.html'), { search: q.toString() });
    }
    mainWindow.once('ready-to-show', () => {
        if (cfg.showOnStart && !hasFlag('--tray'))
            mainWindow?.show();
    });
    const persistBounds = () => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized())
            return;
        const b = mainWindow.getBounds();
        cfg.winX = b.x;
        cfg.winY = b.y;
        cfg.winW = b.width;
        cfg.winH = b.height;
        (0, config_1.saveConfig)(cfg);
    };
    mainWindow.on('resized', persistBounds);
    mainWindow.on('moved', persistBounds);
    const pushMaximised = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('window:maximised', mainWindow.isMaximized());
        }
    };
    mainWindow.on('maximize', pushMaximised);
    mainWindow.on('unmaximize', pushMaximised);
    mainWindow.on('close', (e) => {
        persistBounds();
        if (!quitting) {
            e.preventDefault();
            mainWindow?.hide();
            if (cfg.notify)
                notify('DomeOS AI', l10n('notifyHidden', { hotkey: cfg.hotkey }));
        }
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
}
function notify(title, body) {
    try {
        if (electron_1.Notification.isSupported())
            new electron_1.Notification({ title, body, icon: appIcon() }).show();
    }
    catch {
        /* ignore */
    }
}
// ---------------------------------------------------------------- tray
function buildTrayMenu() {
    const t = resolveTheme();
    const L = l10n;
    return electron_1.Menu.buildFromTemplate([
        { label: L('trayShowHide', { hotkey: cfg.hotkey }), click: () => toggleWindow() },
        {
            label: L('trayQuick', { hotkey: cfg.quick.hotkey }),
            enabled: cfg.quick.enabled,
            click: () => toggleQuick(),
        },
        { type: 'separator' },
        {
            label: L('trayTheme') + (t.dark ? ` · ${L('themeDark')}` : ` · ${L('themeLight')}`),
            submenu: [
                { label: L('themeAuto'), type: 'radio', checked: cfg.theme === 'auto', click: () => setTheme('auto') },
                { label: L('themeLight'), type: 'radio', checked: cfg.theme === 'light', click: () => setTheme('light') },
                { label: L('themeDark'), type: 'radio', checked: cfg.theme === 'dark', click: () => setTheme('dark') },
            ],
        },
        {
            label: L('trayLanguage'),
            submenu: ['auto', 'zh-CN', 'en'].map((l) => ({
                label: l === 'auto' ? L('themeAuto') : l === 'zh-CN' ? '简体中文' : 'English',
                type: 'radio',
                checked: cfg.language === l,
                click: () => setLanguage(l),
            })),
        },
        {
            label: L('trayPerm') + ' · ' + (cfg.agent.scope === 'machine' ? L('trayPermMachine') : L('trayPermWorkspace')),
            submenu: [
                {
                    label: L('trayPermWorkspace'),
                    type: 'radio',
                    checked: cfg.agent.scope === 'workspace',
                    click: () => setPermission('workspace', cfg.agent.autoApprove),
                },
                {
                    label: L('trayPermMachine'),
                    type: 'radio',
                    checked: cfg.agent.scope === 'machine',
                    click: () => setPermission('machine', cfg.agent.autoApprove),
                },
                { type: 'separator' },
                {
                    label: L('trayPermAsk'),
                    type: 'radio',
                    checked: !cfg.agent.autoApprove,
                    click: () => setPermission(cfg.agent.scope, false),
                },
                {
                    label: L('trayPermAuto'),
                    type: 'radio',
                    checked: cfg.agent.autoApprove,
                    click: () => setPermission(cfg.agent.scope, true),
                },
            ],
        },
        { type: 'separator' },
        { label: L('trayOpenConfig'), click: () => (0, config_1.openPathSafe)((0, config_1.getConfigPath)()) },
        { label: L('trayOpenData'), click: () => (0, config_1.openPathSafe)((0, config_1.getDataDir)()) },
        { type: 'separator' },
        { label: L('trayQuit'), click: () => { quitting = true; electron_1.app.quit(); } },
    ]);
}
function refreshTray() {
    if (!tray)
        return;
    tray.setToolTip(`DomeOS AI  ·  ${cfg.hotkey}`);
    tray.setContextMenu(buildTrayMenu());
}
function createTray() {
    const icon = appIcon();
    tray = new electron_1.Tray(icon ? icon.resize({ width: 16, height: 16 }) : electron_1.nativeImage.createEmpty());
    refreshTray();
    tray.on('click', () => toggleWindow());
}
// ---------------------------------------------------------------- state changes
function toggleWindow() {
    if (!mainWindow)
        return;
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    }
    else {
        mainWindow.show();
        mainWindow.focus();
    }
    refreshTray();
}
function setPermission(scope, autoApprove) {
    cfg = { ...cfg, agent: { ...cfg.agent, scope, autoApprove } };
    (0, config_1.saveConfig)(cfg);
    pushConfig();
    refreshTray();
}
function setTheme(mode) {
    cfg.theme = mode;
    (0, config_1.saveConfig)(cfg);
    broadcastTheme(true);
    refreshTray();
    mainWindow?.webContents.send('config:changed', cfg);
}
function applyMediaConfig() {
    if (!media)
        return;
    if (cfg.media.enabled)
        media.start(1000);
    else
        media.stop();
}
function setLanguage(lang) {
    cfg.language = lang;
    (0, config_1.saveConfig)(cfg);
    refreshL10n();
    mainWindow?.webContents.send('config:changed', cfg);
    refreshTray();
}
function pushConfig() {
    mainWindow?.webContents.send('config:changed', cfg);
    applyMediaConfig();
}
// ---------------------------------------------------------------- hotkey
function registerHotkey() {
    electron_1.globalShortcut.unregister(parseAccelerator(cfg.hotkey));
    if (cfg.quick.enabled)
        electron_1.globalShortcut.unregister(parseAccelerator(cfg.quick.hotkey));
    const parsed = parseAccelerator(cfg.hotkey);
    if (electron_1.globalShortcut.register(parsed, () => toggleWindow()))
        return true;
    for (const fb of ['Control+Alt+Shift+G', 'Control+Alt+J', 'Control+Shift+F9']) {
        if (electron_1.globalShortcut.register(fb, () => toggleWindow())) {
            cfg.hotkey = fb.replace('Control', 'Ctrl');
            (0, config_1.saveConfig)(cfg);
            pushConfig();
            return true;
        }
    }
    return false;
}
/** Registers the floating command bar's own hotkey, with fallbacks if it is taken. */
function registerQuickHotkey() {
    if (!cfg.quick.enabled)
        return true;
    const primary = parseAccelerator(cfg.quick.hotkey);
    if (electron_1.globalShortcut.register(primary, () => toggleQuick()))
        return true;
    for (const fb of ['Control+Alt+K', 'Control+Shift+Space', 'Control+Alt+Q']) {
        if (electron_1.globalShortcut.register(fb, () => toggleQuick())) {
            cfg.quick.hotkey = fb.replace('Control', 'Ctrl');
            (0, config_1.saveConfig)(cfg);
            pushConfig();
            quick?.refreshHotkey();
            return true;
        }
    }
    return false;
}
/** The second mode: a floating orb that unfolds into an input panel when clicked. */
/**
 * Summons the orb. The first wake of a run pulses its bars; later ones stay calm, and
 * clicking the orb spends that pulse for good.
 */
function wakeOrb() {
    if (!quick)
        return;
    const first = !voiceWoke;
    voiceWoke = true;
    voiceSession = true;
    quick.show(`v${Date.now().toString(36)}`, cfg.workspace, false, first);
    quick.setWorkspace(cfg.workspace);
}
function toggleQuick(expanded = false) {
    if (!quick)
        return;
    const id = `q${Date.now().toString(36)}`;
    quick.toggle(id, cfg.workspace, expanded);
    quick.setWorkspace(cfg.workspace);
    // opening the orb at all is opening the microphone
    voiceSession = quick.isOpen();
}
/**
 * Settings open as a sheet inside the main window. A second window made the app feel like
 * a browser full of pop-ups; the sheet keeps the navigation, the footer and the app's own
 * background inside one window.
 */
function openSettings(section) {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    if (mainWindow.isMinimized())
        mainWindow.restore();
    if (!mainWindow.isVisible())
        mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('settings:inline', section || 'general');
}
function parseAccelerator(text) {
    const parts = text.split('+').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
        const l = p.toLowerCase();
        if (l === 'ctrl' || l === 'control')
            out.push('Control');
        else if (l === 'alt')
            out.push('Alt');
        else if (l === 'shift')
            out.push('Shift');
        else if (l === 'win' || l === 'super' || l === 'meta')
            out.push('Super');
        else
            out.push(p.length === 1 ? p.toUpperCase() : p);
    }
    return out.length ? out.join('+') : 'Control+Alt+G';
}
// ---------------------------------------------------------------- agent turns
/**
 * Runs one agent turn for whoever asked (the main window or the quick bar).
 * `emit` receives every event; the caller decides how to display it.
 */
function startTurn(threadId, messages, emit, ask) {
    const id = ++streamSeq;
    const controller = new AbortController();
    running.set(id, controller);
    const provider = (0, providers_1.activeProvider)(cfg);
    const agentCfg = { ...cfg.agent };
    const workspace = cfg.workspace;
    // the renderer's transcript already carries a system slot; rebuild it here so the agent
    // rules and the answer-language rule always match the current settings
    const sys = (0, agent_1.systemPrompt)(provider.sysPrompt, workspace, agentCfg.enabled, agentCfg.maxSteps, cfg.language, agentCfg.scope, agentCfg.deepThinking);
    const history = [{ role: 'system', content: sys }, ...messages];
    void (async () => {
        try {
            const result = await (0, agent_1.runAgent)({
                provider,
                agent: agentCfg,
                workspace,
                id,
                threadId,
                signal: controller.signal,
                emit,
                askApproval: (call) => ask(id, call),
                aiController: cfg.aiController.enabled && (0, controller_1.resolveControllerExe)()
                    ? { exe: (0, controller_1.resolveControllerExe)() }
                    : undefined,
            }, history);
            emit({ id, kind: 'done', text: result.text, ok: result.ok, hint: result.hint, steps: result.steps });
            // keep the authoritative conversation so the next turn has the full context
            if (result.wire.length) {
                const existing = (0, store_1.getThread)(threadId);
                (0, store_1.saveThread)({
                    id: threadId,
                    title: existing?.title || (0, store_1.titleFrom)(messages.filter((m) => m.role === 'user').pop()?.content ?? ''),
                    created: existing?.created ?? Date.now(),
                    updated: Date.now(),
                    workspace,
                    wire: result.wire.slice(1),
                    items: existing?.items ?? [],
                });
            }
        }
        catch (err) {
            emit({ id, kind: 'done', text: '', ok: false, hint: `err.internal ${err?.message ?? err}`, steps: 0 });
        }
        finally {
            running.delete(id);
            for (const key of [...approvals.keys()])
                if (key.startsWith(`${id}:`))
                    approvals.delete(key);
        }
    })();
    return id;
}
function waitForApproval(id, call) {
    return new Promise((resolve) => {
        const key = `${id}:${call.id}`;
        approvals.set(key, resolve);
        // if nobody answers, the question expires
        setTimeout(() => {
            if (approvals.delete(key))
                resolve(false);
        }, 300_000);
    });
}
// ---------------------------------------------------------------- ipc
function registerIpc() {
    electron_1.ipcMain.handle('config:get', () => cfg);
    electron_1.ipcMain.handle('config:set', (_e, patch) => {
        const prevHotkey = cfg.hotkey;
        const prevQuickHotkey = cfg.quick.hotkey;
        cfg = {
            ...cfg,
            ...patch,
            agent: { ...cfg.agent, ...(patch.agent ?? {}) },
        };
        if (patch.providers)
            cfg.providers = patch.providers;
        if (patch.workspace !== undefined)
            cfg.workspace = patch.workspace;
        (0, config_1.saveConfig)(cfg);
        refreshL10n();
        if (cfg.hotkey !== prevHotkey)
            registerHotkey();
        if (patch.quick) {
            const prevQuick = prevQuickHotkey;
            if (cfg.quick.enabled && (cfg.quick.hotkey !== prevQuick || patch.quick.enabled === true)) {
                electron_1.globalShortcut.unregister(parseAccelerator(prevQuick));
                registerQuickHotkey();
            }
            else if (!cfg.quick.enabled) {
                electron_1.globalShortcut.unregister(parseAccelerator(prevQuick));
            }
            quick?.refreshHotkey();
            quick?.setWorkspace(cfg.workspace);
        }
        broadcastTheme(true);
        refreshTray();
        pushConfig();
        return cfg;
    });
    electron_1.ipcMain.handle('quick:show', () => {
        // the main window's flash button summons the floating bar
        toggleQuick();
    });
    electron_1.ipcMain.handle('models:list', async () => (0, providers_1.listModels)((0, providers_1.activeProvider)(cfg)));
    // the picker asks about a provider that may not be active yet, and may be unsaved
    electron_1.ipcMain.handle('models:for', async (_e, provider) => {
        const result = await (0, providers_1.listModels)(provider);
        return { models: result, error: result.length ? '' : 'the endpoint returned no model list' };
    });
    electron_1.ipcMain.handle('registry:presets', () => registry_1.PRESETS.map((p) => ({ ...p })));
    // the settings drawer can put the shipped persona back after the user edited it
    electron_1.ipcMain.handle('persona:default', () => persona_1.DEFAULT_SYS);
    // ---------------------------------------------------------------- the settings window
    electron_1.ipcMain.handle('settings:open', (_e, section) => {
        openSettings(section || 'general');
        return true;
    });
    electron_1.ipcMain.handle('settings:close', () => {
        mainWindow?.webContents.send('settings:inline-close');
        return true;
    });
    // ---------------------------------------------------------------- media (SMTC)
    electron_1.ipcMain.handle('media:state', () => media?.getState() ?? { ok: false, sessions: [], active: null });
    electron_1.ipcMain.handle('media:command', (_e, action) => {
        const allowed = ['play', 'pause', 'toggle', 'next', 'previous', 'stop'];
        if (!allowed.includes(action))
            return false;
        return media?.command(action) ?? false;
    });
    electron_1.ipcMain.handle('media:refresh', () => {
        media?.refresh();
        return true;
    });
    media = new media_1.MediaService();
    media.onState((state) => {
        mainWindow?.webContents.send('media:changed', state);
    });
    if (cfg.media.enabled)
        media.start(1000);
    // ------------------------------------------------------------ main window turns
    electron_1.ipcMain.handle('chat:send', (e, req) => {
        const send = (payload) => {
            if (!e.sender.isDestroyed())
                e.sender.send('chat:event', payload);
        };
        return startTurn(req.threadId || 'default', req.messages, send, waitForApproval);
    });
    electron_1.ipcMain.handle('chat:cancel', (_e, id) => {
        running.get(id)?.abort();
        running.delete(id);
        for (const key of [...approvals.keys()]) {
            if (key.startsWith(`${id}:`)) {
                approvals.get(key)?.(false);
                approvals.delete(key);
            }
        }
    });
    electron_1.ipcMain.handle('chat:approve', (_e, id, callId, allow) => {
        const key = `${id}:${callId}`;
        const resolve = approvals.get(key);
        if (resolve) {
            approvals.delete(key);
            resolve(allow);
        }
    });
    // ------------------------------------------------------------ conversations
    electron_1.ipcMain.handle('threads:list', () => (0, store_1.listThreads)());
    electron_1.ipcMain.handle('threads:get', (_e, id) => (0, store_1.getThread)(id));
    electron_1.ipcMain.handle('threads:save', (_e, thread) => {
        (0, store_1.saveThread)(thread);
        return (0, store_1.listThreads)();
    });
    electron_1.ipcMain.handle('threads:delete', (_e, id) => (0, store_1.deleteThread)(id));
    electron_1.ipcMain.handle('threads:rename', (_e, id, title) => (0, store_1.renameThread)(id, title));
    // ------------------------------------------------------------ workspace
    electron_1.ipcMain.handle('workspace:get', () => workspaceInfo());
    electron_1.ipcMain.handle('workspace:set', (_e, root) => {
        cfg.workspace = root;
        (0, config_1.saveConfig)(cfg);
        pushConfig();
        return workspaceInfo();
    });
    electron_1.ipcMain.handle('workspace:pick', async () => {
        if (!mainWindow)
            return null;
        const res = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: l10n('pickFolderTitle'),
            defaultPath: cfg.workspace || node_os_1.default.homedir(),
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: l10n('pickFolderButton'),
        });
        if (res.canceled || !res.filePaths.length)
            return null;
        cfg.workspace = res.filePaths[0];
        (0, config_1.saveConfig)(cfg);
        pushConfig();
        return workspaceInfo();
    });
    electron_1.ipcMain.handle('workspace:tree', (_e, depth) => (0, tools_1.workspaceTree)(cfg.workspace, Math.min(5, Math.max(1, depth ?? 3))));
    electron_1.ipcMain.handle('workspace:read', (_e, target) => {
        const root = node_path_1.default.resolve(cfg.workspace);
        const abs = node_path_1.default.resolve(root, target);
        if (abs !== root && !abs.startsWith(root + node_path_1.default.sep))
            throw new Error('outside the workspace');
        const st = node_fs_1.default.statSync(abs);
        if (st.isDirectory())
            throw new Error('that is a folder');
        const raw = node_fs_1.default.readFileSync(abs).subarray(0, tools_1.MAX_READ_BYTES).toString('utf8');
        return { path: abs, text: raw, truncated: st.size > tools_1.MAX_READ_BYTES };
    });
    // ---------------------------------------------------------------- the background image
    electron_1.ipcMain.handle('background:pick', async () => {
        if (!mainWindow)
            return null;
        const res = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: l10n('pickImageTitle'),
            defaultPath: electron_1.app.getPath('pictures'),
            properties: ['openFile'],
            filters: [
                { name: l10n('imageFiles'), extensions: background_1.ALLOWED_EXT },
                { name: 'Video (mp4 / webm / ogv)', extensions: background_1.VIDEO_EXT },
            ],
            buttonLabel: l10n('pickImageButton'),
        });
        if (res.canceled || !res.filePaths.length)
            return null;
        const pickedExt = node_path_1.default.extname(res.filePaths[0]).replace('.', '').toLowerCase();
        const isVideo = background_1.VIDEO_EXT.includes(pickedExt);
        const stored = isVideo
            ? (0, background_1.storeBackgroundVideo)(res.filePaths[0], (0, config_1.getDataDir)())
            : (0, background_1.storeBackground)(res.filePaths[0], (0, config_1.getDataDir)());
        if (!stored.ok) {
            // the renderer shows this, so a failed import cannot look like a silent no-op
            throw new Error(stored.error ?? 'the background could not be imported');
        }
        cfg.background.file = isVideo
            ? `background.${pickedExt}`
            : node_path_1.default.basename((0, background_1.backgroundPath)((0, config_1.getDataDir)()));
        (0, config_1.saveConfig)(cfg);
        pushConfig();
        return cfg.background;
    });
    electron_1.ipcMain.handle('background:clear', () => {
        (0, background_1.removeBackground)((0, config_1.getDataDir)());
        cfg.background.file = '';
        (0, config_1.saveConfig)(cfg);
        pushConfig();
        return cfg.background;
    });
    electron_1.ipcMain.handle('background:image', () => (0, background_1.readBackground)((0, config_1.getDataDir)()));
    // ---------------------------------------------------------------- speech synthesis (TTS)
    // MiMo TTS whenever its key is set, the Windows voices as the fallback; the renderer
    // only ever receives finished WAV bytes, so both engines play through the same path
    // keyed so a run can be aborted from the renderer: "stop" cancels the request itself
    // instead of only silencing whatever audio already arrived
    electron_1.ipcMain.handle('tts:speak', async (_e, text, key) => {
        const abort = new AbortController();
        if (key)
            ttsRuns.set(key, abort);
        try {
            return await (0, tts_1.speakText)(cfg, text, abort.signal);
        }
        finally {
            if (key)
                ttsRuns.delete(key);
        }
    });
    electron_1.ipcMain.handle('tts:cancel', (_e, key) => {
        const abort = ttsRuns.get(key);
        if (abort) {
            abort.abort();
            ttsRuns.delete(key);
        }
        return true;
    });
    electron_1.ipcMain.handle('tts:voices', () => (0, tts_1.listWindowsVoices)());
    // ---------------------------------------------------------------- the bundled AI Controller
    electron_1.ipcMain.handle('aicontroller:path', () => (0, controller_1.resolveControllerExe)());
    electron_1.ipcMain.handle('aicontroller:launch', () => (0, controller_1.launchController)());
    electron_1.ipcMain.handle('aicontroller:stop', () => (0, controller_1.stopController)());
    electron_1.ipcMain.handle('aicontroller:sync-paths', () => ({
        found: (0, controller_1.resolveConfigSetter)(),
        dir: (0, controller_1.resolveControllerExe)() ? node_path_1.default.dirname((0, controller_1.resolveControllerExe)()) : null,
    }));
    // The main model is the one the app is actually talking to, so its saved values are what
    // gets handed over - not whatever is sitting unsaved in the settings draft.
    electron_1.ipcMain.handle('aicontroller:sync', () => {
        const provider = (0, providers_1.activeProvider)(cfg);
        return (0, controller_1.syncControllerApi)(provider.base, provider.key, provider.model);
    });
    electron_1.ipcMain.handle('theme:resolved', () => resolveTheme());
    electron_1.ipcMain.handle('paths', () => ({
        config: (0, config_1.getConfigPath)(),
        data: (0, config_1.getDataDir)(),
        exe: electron_1.app.getPath('exe'),
    }));
    electron_1.ipcMain.handle('app:version', () => electron_1.app.getVersion());
    electron_1.ipcMain.handle('app:quit', () => { quitting = true; voice_1.VoiceService.stop(); electron_1.app.quit(); });
    electron_1.ipcMain.handle('shell:open', (_e, target) => (0, config_1.openPathSafe)(target));
    electron_1.ipcMain.handle('shell:external', (_e, url) => (0, config_1.openExternalSafe)(url));
    electron_1.ipcMain.on('window:minimise', () => mainWindow?.minimize());
    electron_1.ipcMain.on('window:maximise', () => {
        if (!mainWindow)
            return;
        if (mainWindow.isMaximized())
            mainWindow.unmaximize();
        else
            mainWindow.maximize();
        mainWindow.webContents.send('window:maximised', mainWindow.isMaximized());
    });
    electron_1.ipcMain.handle('window:isMaximised', () => !!mainWindow?.isMaximized());
    electron_1.ipcMain.on('window:close', () => mainWindow?.close());
    electron_1.ipcMain.on('app:newchat', () => mainWindow?.webContents.send('chat:new'));
    electron_1.ipcMain.on('app:badge', (_e, n) => {
        if (process.platform === 'win32') {
            mainWindow?.setOverlayIcon(n > 0 ? electron_1.nativeImage.createFromPath(iconPath('icon-32.png')) : null, n > 0 ? String(n) : '');
        }
    });
    electron_1.ipcMain.on('folder:config', () => (0, config_1.openPathSafe)((0, config_1.getConfigPath)()));
    electron_1.ipcMain.on('folder:data', () => (0, config_1.openPathSafe)((0, config_1.getDataDir)()));
}
/**
 * A turn started from the floating bar. Its conversation is created on first use so the
 * main window can pick it up later; events go to the bar only.
 */
async function runQuickTurn(text, threadId) {
    const id = threadId || `q${Date.now().toString(36)}`;
    const existing = (0, store_1.getThread)(id);
    const now = Date.now();
    if (!existing) {
        (0, store_1.saveThread)({
            id,
            title: (0, store_1.titleFrom)(text),
            created: now,
            updated: now,
            workspace: cfg.workspace,
            wire: [],
            items: [],
        });
    }
    const caller = ++quickSeq;
    quick?.setBusy(true);
    const emit = (payload) => {
        if (caller !== quickSeq)
            return;
        quick?.emit(payload);
        // mirror the exchange into the stored conversation so the main window shows it
        if (payload.kind === 'done') {
            const thread = (0, store_1.getThread)(id);
            if (thread) {
                const items = thread.items.slice();
                items.push({ kind: 'user', text });
                if (payload.ok && payload.text) {
                    items.push({ kind: 'assistant', text: payload.text, chars: payload.text.length });
                }
                else if (!payload.ok) {
                    items.push({ kind: 'error', text: payload.hint ?? 'err.http' });
                }
                (0, store_1.saveThread)({ ...thread, items, workspace: cfg.workspace });
            }
            quick?.setBusy(false);
            if (cfg.quick.openMain && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('thread:open', id);
            }
        }
    };
    const history = existing?.wire ?? [];
    startTurn(id, [...history, { role: 'user', content: text }], emit, async () => true);
}
function workspaceInfo() {
    const root = cfg.workspace;
    const name = root ? node_path_1.default.basename(root) || root : '';
    return { root, name, exists: !!root && node_fs_1.default.existsSync(root) };
}
// ---------------------------------------------------------------- boot
if (hasFlag('--selftest')) {
    // verify the build inside a real Electron main process, then exit. The config module
    // needs a ready app object (it resolves paths through app.getPath), so wait for it.
    electron_1.app.whenReady().then(() => {
        const logFile = flagValue('--log');
        if (logFile)
            (0, selftest_1.setSelfTestLog)(logFile);
        (0, selftest_1.runSelfTest)();
    });
}
else {
    const gotLock = electron_1.app.requestSingleInstanceLock();
    if (!gotLock) {
        electron_1.app.quit();
    }
    else {
        electron_1.app.on('second-instance', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
        electron_1.app.whenReady().then(() => {
            electron_1.app.setAppUserModelId('com.domeos.ai');
            cfg = (0, config_1.loadConfig)();
            refreshL10n();
            electron_1.nativeTheme.themeSource = cfg.theme === 'auto' ? 'system' : cfg.theme;
            // the agent needs a workspace; fall back to the user's home folder
            if (!cfg.workspace || !node_fs_1.default.existsSync(cfg.workspace)) {
                cfg.workspace = node_os_1.default.homedir();
                (0, config_1.saveConfig)(cfg);
            }
            registerIpc();
            createWindow();
            createTray();
            electron_1.protocol.handle('domeos-bg', (req) => {
                const u = new URL(req.url);
                if (u.host !== 'video')
                    return new Response('not found', { status: 404 });
                const file = (0, background_1.backgroundVideoPath)((0, config_1.getDataDir)());
                const ext = node_path_1.default.extname(file).replace('.', '').toLowerCase();
                const mime = ext === 'webm' ? 'video/webm' : ext === 'ogv' ? 'video/ogg' : 'video/mp4';
                const stream = node_fs_1.default.createReadStream(file);
                return new Response(node_stream_1.default.Readable.toWeb(stream), { headers: { 'content-type': mime } });
            });
            // the floating command bar: its own hotkey, its own always-on-top window
            quick = new quickbar_1.QuickBar({
                devUrl,
                getHotkey: () => cfg.quick.hotkey,
                getGlow: () => ({ thickness: cfg.quick.thickness, color: cfg.quick.color, hideAfterMs: cfg.quick.hideAfterMs }),
                isDark: () => resolveTheme().dark,
                getOrb: () => ({
                    enabled: cfg.orb.enabled,
                    primary: cfg.orb.primary,
                    secondary: cfg.orb.secondary,
                    barSize: cfg.orb.barSize,
                }),
                onSend: (text, threadId) => runQuickTurn(text, threadId),
                onCancel: () => {
                    for (const [id, c] of running) {
                        c.abort();
                        running.delete(id);
                    }
                },
                onOpenMain: () => {
                    quick?.hide();
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.show();
                        mainWindow.focus();
                    }
                },
                onVoiceStart: () => {
                    voiceSession = true;
                    if (voice_1.VoiceService.isRunning() && voiceReady)
                        return { ok: true };
                    return { ok: false, error: voice_1.VoiceService.lastError() || 'voice service is not running' };
                },
                onVoiceStop: () => {
                    // the service keeps listening for the wake phrase, but this session is over:
                    // the dictation stream simply stops being forwarded to the orb
                    voiceSession = false;
                },
                onHide: () => { voiceSession = false; quick?.hide(); },
            });
            quick.attachIpc(electron_1.ipcMain);
            quick.setWorkspace(cfg.workspace);
            // the voice service: always listening for the wake phrase so the orb can be
            // summoned by voice even while the window is hidden
            voice_1.VoiceService.setHandler((kind, text) => {
                if (kind === 'READY') {
                    voiceReady = true;
                    return;
                }
                if (kind === 'ERR') {
                    voiceReady = false;
                    console.log('[voice] ' + text);
                    return;
                }
                if (kind === 'WAKE') {
                    wakeOrb();
                    return;
                }
                if (!voiceSession)
                    return;
                quick?.sendVoice(kind, text);
            });
            if (cfg.voice.enabled)
                voice_1.VoiceService.start();
            if (!registerHotkey()) {
                notify('DomeOS AI', l10n('notifyHotkeyTaken', { hotkey: cfg.hotkey }));
            }
            if (!registerQuickHotkey()) {
                notify('DomeOS AI', l10n('notifyQuickHotkeyTaken', { hotkey: cfg.quick.hotkey }));
            }
            electron_1.nativeTheme.on('updated', () => {
                if (cfg.theme === 'auto')
                    broadcastTheme(true);
            });
            // headless verification hooks
            const demo = flagValue('--demo');
            if (demo) {
                mainWindow?.once('ready-to-show', () => {
                    mainWindow?.show();
                });
                if (!hasFlag('--keep')) {
                    const seconds = Math.max(2, Number(demo) || 6);
                    setTimeout(() => { quitting = true; electron_1.app.quit(); }, seconds * 1000);
                }
            }
            if (hasFlag('--tray'))
                mainWindow?.hide();
            // --uishot=<png> grabs the rendered window from inside Electron, which works even
            // when another application owns the foreground.
            const shot = flagValue('--uishot');
            if (shot) {
                const grab = async (delayMs) => {
                    await new Promise((r) => setTimeout(r, delayMs));
                    if (!mainWindow || mainWindow.isDestroyed())
                        return;
                    try {
                        const img = await mainWindow.webContents.capturePage();
                        node_fs_1.default.writeFileSync(shot, img.toPNG());
                        console.log('[ ok ] window shot ' + shot);
                    }
                    catch (e) {
                        console.error('[FAIL] capture failed: ' + (e?.message ?? e));
                    }
                };
                mainWindow?.webContents.once('did-finish-load', () => void grab(hasFlag('--opensettings') ? 3400 : 1800));
            }
            // --chatsend="<text>" drives one real turn through the MAIN window, for end-to-end checks
            const chatSend = flagValue('--chatsend');
            if (chatSend) {
                const drive = async () => {
                    // React owns the textarea value, so the native setter plus an input event is what
                    // actually updates the component's state; a plain .value assignment would be ignored
                    const typed = await mainWindow?.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector('#composer') || document.querySelector('textarea');
          if (!ta) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, ${JSON.stringify(chatSend)});
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
                    if (!typed)
                        return false;
                    await new Promise((r) => setTimeout(r, 400));
                    // Enter is what the composer listens for, so this goes through the real send path
                    await mainWindow?.webContents.executeJavaScript(`(() => {
          const ta = document.querySelector('#composer') || document.querySelector('textarea');
          if (!ta) return false;
          ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return true;
        })()`);
                    return true;
                };
                // the renderer may still be mounting when the flag is read, so keep trying until the
                // composer actually exists instead of firing once into an empty page
                let tries = 0;
                const tick = () => {
                    tries++;
                    void drive()
                        .then((done) => {
                        if (done)
                            console.log('[ ok ] chat send driven');
                        else if (tries < 60)
                            setTimeout(tick, 500);
                        else
                            console.error('[FAIL] chat send: the composer never appeared');
                    })
                        .catch((e) => console.error('[FAIL] chat send: ' + (e?.message ?? e)));
                };
                setTimeout(tick, 1500);
            }
            // --chatprobe=<file> dumps every bubble's width and text, so a duplicated answer or a
            // ragged column shows up as data rather than as a screenshot
            const chatProbeFile = flagValue('--chatprobe');
            if (chatProbeFile) {
                setTimeout(async () => {
                    try {
                        const text = await mainWindow?.webContents.executeJavaScript(`(() => {
            const bubbles = Array.prototype.slice.call(document.querySelectorAll('.bubble'));
            const rows = bubbles.map(function (el) {
              const r = el.getBoundingClientRect();
              return Math.round(r.width) + 'x' + Math.round(r.height) + ' :: ' + JSON.stringify((el.textContent || '').trim().slice(0, 46));
            });
            return 'bubbles=' + bubbles.length + ' || ' + rows.join(' || ');
          })()`);
                        node_fs_1.default.writeFileSync(chatProbeFile, String(text), 'utf8');
                        console.log('[ ok ] chat probe');
                    }
                    catch (e) {
                        console.error('[FAIL] chat probe: ' + (e?.message ?? e));
                    }
                }, 14000);
            }
            // --quicksend="<text>" drives one real turn through the bar, for end-to-end checks
            const quickSend = flagValue('--quicksend');
            const quickExpand = hasFlag('--quickexpand');
            if (quickSend) {
                setTimeout(() => {
                    toggleQuick(quickExpand);
                    const bar = quick;
                    setTimeout(() => {
                        if (bar?.win && !bar.win.isDestroyed()) {
                            bar.win.webContents.send('quick:reset');
                            void runQuickTurn(quickSend, `q${Date.now().toString(36)}`);
                        }
                    }, 1500);
                }, 2200);
            }
            // --quickprobe=<file> dumps the lines the floating panel is showing, so a streaming bug
            // can be seen as data instead of as a screenshot
            const quickProbeFile = flagValue('--quickprobe');
            if (quickProbeFile) {
                setTimeout(async () => {
                    try {
                        const script = [
                            "(function () {",
                            "  var rows = document.querySelectorAll('.lines > div');",
                            "  var out = [];",
                            "  for (var i = 0; i < rows.length; i++) {",
                            "    out.push(i + ': ' + (rows[i].textContent || '').slice(0, 90));",
                            "  }",
                            "  return 'lines=' + rows.length + ' || ' + out.join(' || ');",
                            "})()",
                        ].join('\n');
                        const text = await quick?.probe(script);
                        node_fs_1.default.writeFileSync(quickProbeFile, String(text), 'utf8');
                        console.log('[ ok ] quick probe');
                    }
                    catch (e) {
                        console.error('[FAIL] quick probe: ' + (e?.message ?? e));
                    }
                }, 16000);
            }
            // --settingshot=<png> photographs the main window with the settings sheet open
            const settingsShot = flagValue('--settingshot');
            if (settingsShot) {
                setTimeout(async () => {
                    try {
                        if (!mainWindow || mainWindow.isDestroyed()) {
                            throw new Error('the main window is not open');
                        }
                        const image = await mainWindow.webContents.capturePage();
                        node_fs_1.default.writeFileSync(settingsShot, image.toPNG());
                        console.log('[ ok ] settings sheet shot ' + settingsShot);
                    }
                    catch (e) {
                        console.error('[FAIL] settings shot: ' + (e?.message ?? e));
                    }
                }, 6000);
            }
            // --uiprobe=<file> dumps the measured layout. A screenshot cannot tell you whether a row
            // was pushed off the bottom of the window, and this can.
            const probeFile = flagValue('--uiprobe');
            if (probeFile) {
                setTimeout(async () => {
                    try {
                        const rows = await mainWindow?.webContents.executeJavaScript(`(() => {
            const pick = (sel) => {
              const el = document.querySelector(sel);
              if (!el) return sel + ': MISSING';
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return sel + ': ' + r.width.toFixed(1) + 'x' + r.height.toFixed(1)
                + ' @' + r.top.toFixed(1) + '..' + r.bottom.toFixed(1)
                + ' flex=' + cs.flex + ' minH=' + cs.minHeight + ' pad=' + cs.paddingTop + '/' + cs.paddingBottom;
            };
            const app = document.querySelector('.app');
            const kids = app ? [...app.children].map((el) => Math.round(el.getBoundingClientRect().height)).join(',') : '';
            const bg = document.querySelector('.bgImage');
            const bgLine = bg
              ? 'bgImage: ' + getComputedStyle(bg).backgroundImage.slice(0, 40)
                + ' size=' + getComputedStyle(bg).backgroundSize
                + ' blur=' + getComputedStyle(bg).filter
              : 'bgImage: MISSING';
            return [
              'window ' + window.innerWidth + 'x' + window.innerHeight,
              'appChildren(h): ' + kids,
              bgLine,
              (() => {
                const prov = document.querySelector('.app')?.parentElement;
                const pr = prov?.getBoundingClientRect();
                const ps = prov ? getComputedStyle(prov) : null;
                const ar = document.querySelector('.app')?.getBoundingClientRect();
                const as = getComputedStyle(document.querySelector('.app'));
                return 'provider: ' + (pr ? pr.width.toFixed(1) + 'x' + pr.height.toFixed(1) + ' @' + pr.top.toFixed(1) + '..' + pr.bottom.toFixed(1) : 'none')
                  + ' | app.margin=' + as.marginTop + '/' + as.marginBottom + ' app.pos=' + as.position
                  + ' app.display=' + as.display + ' app.parentTag=' + document.querySelector('.app')?.parentElement?.tagName
                  + ' parentClass=' + (document.querySelector('.app')?.parentElement?.className || '').slice(0, 40)
                  + ' bodyMargin=' + getComputedStyle(document.body).margin;
              })(),
              (() => {
                const r = document.getElementById('root')?.getBoundingClientRect();
                const b = document.body.getBoundingClientRect();
                return 'root: ' + (r ? r.height.toFixed(1) + ' @' + r.top.toFixed(1) + '..' + r.bottom.toFixed(1) : '?') + '  body: ' + b.height.toFixed(1) + '  docEl: ' + document.documentElement.clientHeight;
              })(),
              (() => {
                const side = document.querySelector('.shell > div');
                const grip = document.querySelector('[role="separator"]');
                const notice = document.querySelector('.notice');
                const bubbles = Array.prototype.slice.call(document.querySelectorAll('.bubble.ai'));
                return 'sidebar: ' + (side ? Math.round(side.getBoundingClientRect().width) + 'px' : 'MISSING')
                  + ' grip: ' + (grip ? 'yes' : 'no')
                  + ' notice: ' + JSON.stringify((notice?.textContent || '').slice(0, 44))
                  + ' aiBubbles: ' + bubbles.map(function (el) { return Math.round(el.getBoundingClientRect().width); }).join(',');
              })(),
              (() => {
                const app = document.querySelector('.app');
                const pane = document.querySelector('.sidebarPane');
                const send = document.querySelector('.composer button[class*="primary"], .composer button');
                const cs = app ? getComputedStyle(app) : null;
                return 'colours: appBg=' + (cs?.backgroundColor ?? '?')
                  + ' sidebarVar=' + (cs?.getPropertyValue('--dome-sidebar') || '(unset)')
                  + ' linkVar=' + (cs?.getPropertyValue('--dome-link') || '(unset)')
                  + ' sidebarBg=' + (pane ? getComputedStyle(pane).backgroundColor : '?')
                  + ' sendBg=' + (send ? getComputedStyle(send).backgroundColor : '?');
              })(),
              (() => {
                // the accent has to reach real Fluent controls, not just a CSS variable
                const wanted = 'rgb(224, 27, 36)';
                const all = Array.prototype.slice.call(document.querySelectorAll('button, [role="switch"], [role="tab"]'));
                const hits = all.filter(function (el) {
                  const cs = getComputedStyle(el);
                  return cs.backgroundColor === wanted || cs.borderTopColor === wanted || cs.color === wanted;
                }).length;
                return 'accentHits: ' + hits + '/' + all.length + ' controls carry the custom accent';
              })(),
              (() => {
                const chips = Array.prototype.slice.call(document.querySelectorAll('.composerBar button'));
                return chips.map(function (el, i) {
                  const cs = getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  return 'chip' + i + ' ' + Math.round(r.width) + 'px bg=' + cs.backgroundColor
                    + ' fg=' + cs.color + ' bd=' + cs.borderTopColor
                    + ' txt="' + (el.textContent || '').slice(0, 14) + '"';
                }).join(' | ');
              })(),
              'theme.dark=' + document.querySelector('.app').classList.contains('dark'),
              pick('.app'), pick('.shell'), pick('.mainCol'), pick('.transcript'),
              pick('.composer'), pick('.composerBar'), pick('.hintBar'), pick('.mediaRow'),
            ].join('\\n');
          })()`);
                        node_fs_1.default.writeFileSync(probeFile, String(rows), 'utf8');
                        console.log('[ ok ] layout probe ' + probeFile);
                    }
                    catch (e) {
                        console.error('[FAIL] layout probe: ' + (e?.message ?? e));
                    }
                }, 3500);
            }
            // --pickerprobe=<file> dumps the provider catalogue structure. The script is passed as a
            // string expression: executeJavaScript evaluates it, it does not call a function.
            const pickerProbe = flagValue('--pickerprobe');
            if (pickerProbe) {
                setTimeout(async () => {
                    try {
                        const script = [
                            "(function () {",
                            "  var out = [];",
                            "  var groups = document.querySelectorAll('[data-group]');",
                            "  for (var i = 0; i < groups.length; i++) {",
                            "    var g = groups[i];",
                            "    var rs = g.parentElement.querySelectorAll('[role=button]');",
                            "    out.push(g.getAttribute('data-group') + ' (' + g.textContent + '): ' + rs.length + ' rows');",
                            "  }",
                            "  var custom = document.querySelector('[data-custom]');",
                            "  out.push('CUSTOM ROW: ' + (custom ? custom.textContent : 'MISSING'));",
                            "  return out.join(' || ');",
                            "})()",
                        ].join('\n');
                        const rows = await mainWindow?.webContents.executeJavaScript(script);
                        node_fs_1.default.writeFileSync(pickerProbe, String(rows), 'utf8');
                        console.log('[ ok ] picker probe');
                    }
                    catch (e) {
                        console.error('[FAIL] picker probe: ' + (e?.message ?? e));
                    }
                }, 3600);
            }
            // --quickshot=<png> photographs the floating command bar (after --quicksend ran)
            const quickShot = flagValue('--quickshot');
            if (quickShot) {
                setTimeout(async () => {
                    try {
                        const bar = quick;
                        if (!quick?.isOpen())
                            toggleQuick(quickExpand);
                        await new Promise((r) => setTimeout(r, 900));
                        const target = quick?.win ?? null;
                        if (!target || target.isDestroyed())
                            throw new Error('the bar window is not up');
                        if (!target.isVisible())
                            target.showInactive();
                        await new Promise((r) => setTimeout(r, 400));
                        const img = await target.webContents.capturePage();
                        node_fs_1.default.writeFileSync(quickShot, img.toPNG());
                        console.log('[ ok ] quick bar shot ' + quickShot);
                    }
                    catch (e) {
                        console.error('[FAIL] quick shot: ' + (e?.message ?? e));
                    }
                }, quickSend ? 14000 : 3600);
            }
        });
        electron_1.app.on('will-quit', (e) => {
            e.preventDefault();
            quitting = true;
            for (const c of running.values())
                c.abort();
            electron_1.globalShortcut.unregisterAll();
                quick?.destroy();
            (0, store_1.flushStore)();
            (0, config_1.saveConfig)(cfg);
            setTimeout(() => electron_1.app.exit(0), 120);
        });
        electron_1.app.on('window-all-closed', () => {
            // the tray keeps the app alive; quitting happens from the tray menu
        });
    }
}
