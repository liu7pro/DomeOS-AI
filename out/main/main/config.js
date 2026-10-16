"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_FILE_NAME = exports.APP_DIR_NAME = void 0;
exports.defaultConfig = defaultConfig;
exports.resolveDataDir = resolveDataDir;
exports.getDataDir = getDataDir;
exports.getConfigPath = getConfigPath;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.systemPrefersDark = systemPrefersDark;
exports.openPathSafe = openPathSafe;
exports.openExternalSafe = openExternalSafe;
exports.homeDir = homeDir;
// src/main/config.ts - INI-style configuration, stored beside the app or in %APPDATA%
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const registry_1 = require("./registry");
const palette_1 = require("../shared/palette");
exports.APP_DIR_NAME = 'DomeOSAI';
exports.APP_FILE_NAME = 'config.ini';
function defaultConfig() {
    return {
        active: 0,
        autostart: false,
        notify: true,
        history: 20,
        language: 'auto',
        theme: 'auto',
        // one of the built-in accent families, or an empty string for the classic blue
        themePreset: 'qq',
        // a flat decorative pattern painted under the ambience: none / grid / diag / wave / diamond
        ornament: 'none',
        hotkey: 'Ctrl+Alt+G',
        showOnStart: true,
        sidebarWidth: 244,
        winW: 960,
        winH: 640,
        winX: 0,
        winY: 0,
        orb: {
            enabled: true,
            // DomeOS blue with the logo's yellow as the highlight by default
            primary: '4A90E2',
            secondary: 'FFC90E',
            size: 34,
            barSize: 96,
        },
        legalAccepted: '',
        // written once the first-run guide has been completed; empty means "show it"
        onboarded: '',
        background: { file: '', blur: 18, dim: 0.35, fit: 'cover', volume: 0 },
        aiController: { enabled: false },
        colors: { light: {}, dark: {} },
        media: {
            enabled: true,
            showChip: true,
        },
        voice: {
            // the always-on Windows speech service behind the "Hey, Dome" wake phrase
            enabled: true,
        },
        tts: {
            // speech synthesis: MiMo TTS whenever a key is set, the Windows voices otherwise
            engine: 'auto',
            autoRead: false,
            mimoKey: '',
            mimoBase: 'https://api.xiaomimimo.com/v1',
            mimoModel: 'mimo-v2.5-tts',
            mimoVoice: 'mimo_default',
            mimoStyle: '',
            msVoice: '',
            msRate: 0,
        },
        quick: {
            enabled: true,
            // the second hotkey: a floating input box with a light border around the screen
            hotkey: 'Ctrl+Alt+Space',
            hideAfterMs: 9000,
            thickness: 6,
            color: '4A90E2',
            openMain: false,
        },
        agent: {
            enabled: true,
            deepThinking: false,
            webSearch: true,
            // workspace = jailed to the folder; machine = every drive on the computer
            scope: 'workspace',
            autoApprove: false,
            maxSteps: 12,
            maxOutput: 20000,
            shellTimeoutMs: 90000,
        },
        workspace: '',
        providers: (0, registry_1.defaultProviders)(),
    };
}
/** The config lives beside the executable when %APPDATA% is not writable. */
function resolveDataDir() {
    const candidates = [];
    if (process.env.APPDATA)
        candidates.push(node_path_1.default.join(process.env.APPDATA, exports.APP_DIR_NAME));
    if (process.env.LOCALAPPDATA)
        candidates.push(node_path_1.default.join(process.env.LOCALAPPDATA, exports.APP_DIR_NAME));
    candidates.push(node_path_1.default.join(node_path_1.default.dirname(electron_1.app.getPath('exe')), exports.APP_DIR_NAME));
    for (const dir of candidates) {
        try {
            node_fs_1.default.mkdirSync(dir, { recursive: true });
            const probe = node_path_1.default.join(dir, '.write-probe');
            node_fs_1.default.writeFileSync(probe, 'x');
            node_fs_1.default.unlinkSync(probe);
            return dir;
        }
        catch {
            /* try the next candidate */
        }
    }
    return candidates[candidates.length - 1];
}
let dataDir = '';
function getDataDir() {
    if (!dataDir)
        dataDir = resolveDataDir();
    return dataDir;
}
function getConfigPath() {
    return node_path_1.default.join(getDataDir(), exports.APP_FILE_NAME);
}
// ---------------------------------------------------------------- ini helpers
function parseIni(text) {
    const out = new Map();
    let section = '';
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('#'))
            continue;
        const m = /^\[(.+)\]$/.exec(line);
        if (m) {
            section = m[1];
            if (!out.has(section))
                out.set(section, new Map());
            continue;
        }
        const eq = line.indexOf('=');
        if (eq < 0)
            continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (!section)
            continue;
        if (!out.has(section))
            out.set(section, new Map());
        out.get(section).set(key, value);
    }
    return out;
}
function boolOf(v, def) {
    if (v === undefined)
        return def;
    const s = v.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s))
        return true;
    if (['0', 'false', 'no', 'off'].includes(s))
        return false;
    return def;
}
function numOf(v, def) {
    if (v === undefined)
        return def;
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
const LANGS = ['auto', 'zh-CN', 'en'];
const THEMES = ['auto', 'light', 'dark'];
function loadConfig() {
    const cfg = defaultConfig();
    const file = getConfigPath();
    let text = '';
    try {
        text = node_fs_1.default.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    }
    catch {
        saveConfig(cfg);
        return cfg;
    }
    const ini = parseIni(text);
    const appSec = ini.get('app');
    const uiSec = ini.get('ui');
    const agentSec = ini.get('agent');
    const quickSec = ini.get('quick');
    const orbSec = ini.get('orb');
    const wsSec = ini.get('workspace');
    if (appSec) {
        cfg.active = Math.max(0, Math.trunc(numOf(appSec.get('active'), cfg.active)));
        cfg.autostart = boolOf(appSec.get('autostart'), cfg.autostart);
        cfg.notify = boolOf(appSec.get('notify'), cfg.notify);
        cfg.history = Math.max(2, Math.trunc(numOf(appSec.get('history'), cfg.history)));
        const lang = appSec.get('language');
        if (lang && LANGS.includes(lang))
            cfg.language = lang;
        const theme = appSec.get('theme');
        if (theme && THEMES.includes(theme))
            cfg.theme = theme;
    }
    if (agentSec) {
        cfg.agent.enabled = boolOf(agentSec.get('enabled'), cfg.agent.enabled);
        cfg.agent.deepThinking = boolOf(agentSec.get('deepThinking'), cfg.agent.deepThinking);
        cfg.agent.webSearch = boolOf(agentSec.get('webSearch'), cfg.agent.webSearch);
        const scope = (agentSec.get('scope') ?? cfg.agent.scope).toLowerCase();
        if (scope === 'machine' || scope === 'full' || scope === 'computer')
            cfg.agent.scope = 'machine';
        else if (scope === 'workspace' || scope === 'folder')
            cfg.agent.scope = 'workspace';
        cfg.agent.autoApprove = boolOf(agentSec.get('autoApprove'), cfg.agent.autoApprove);
        // 0 is a real value for all three: it means "no limit"
        cfg.agent.maxSteps = clampLimit(agentSec.get('maxSteps'), cfg.agent.maxSteps, 40);
        cfg.agent.maxOutput = clampLimit(agentSec.get('maxOutput'), cfg.agent.maxOutput, 200_000);
        cfg.agent.shellTimeoutMs = clampLimit(agentSec.get('shellTimeoutMs'), cfg.agent.shellTimeoutMs, 600_000);
    }
    if (quickSec) {
        cfg.quick.enabled = boolOf(quickSec.get('enabled'), cfg.quick.enabled);
        cfg.quick.hotkey = quickSec.get('hotkey') ?? cfg.quick.hotkey;
        cfg.quick.hideAfterMs = Math.min(120_000, Math.max(0, Math.trunc(numOf(quickSec.get('hideAfterMs'), cfg.quick.hideAfterMs))));
        cfg.quick.thickness = Math.min(24, Math.max(2, Math.trunc(numOf(quickSec.get('thickness'), cfg.quick.thickness))));
        const quickColor = (quickSec.get('color') ?? cfg.quick.color).replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(quickColor))
            cfg.quick.color = quickColor.toUpperCase();
        cfg.quick.openMain = boolOf(quickSec.get('openMain'), cfg.quick.openMain);
    }
    if (orbSec) {
        cfg.orb.enabled = boolOf(orbSec.get('enabled'), cfg.orb.enabled);
        const orbPrimary = (orbSec.get('primary') ?? cfg.orb.primary).replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(orbPrimary))
            cfg.orb.primary = orbPrimary.toUpperCase();
        const orbSecondary = (orbSec.get('secondary') ?? cfg.orb.secondary).replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(orbSecondary))
            cfg.orb.secondary = orbSecondary.toUpperCase();
        cfg.orb.size = Math.min(64, Math.max(16, Math.trunc(numOf(orbSec.get('size'), cfg.orb.size))));
        cfg.orb.barSize = Math.min(180, Math.max(40, Math.trunc(numOf(orbSec.get('barSize'), cfg.orb.barSize))));
    }
    if (wsSec?.get('root'))
        cfg.workspace = wsSec.get('root');
    if (uiSec) {
        cfg.hotkey = uiSec.get('hotkey') ?? cfg.hotkey;
        // both are rendered into a CSS selector, so only the known tokens are accepted
        const preset = uiSec.get('themePreset') ?? '';
        if (['qq', 'jade', 'violet', 'sakura', 'amber', 'mono'].includes(preset))
            cfg.themePreset = preset;
        const ornament = uiSec.get('ornament') ?? '';
        if (['none', 'grid', 'diag', 'wave', 'diamond'].includes(ornament))
            cfg.ornament = ornament;
        cfg.showOnStart = boolOf(uiSec.get('showOnStart'), cfg.showOnStart);
        // clamped on load too: a hand-edited config.ini must not be able to hide the sidebar
        cfg.sidebarWidth = Math.min(560, Math.max(190, Math.trunc(numOf(uiSec.get('sidebarWidth'), cfg.sidebarWidth))));
        cfg.winW = Math.max(640, Math.trunc(numOf(uiSec.get('winW'), cfg.winW)));
        cfg.winH = Math.max(460, Math.trunc(numOf(uiSec.get('winH'), cfg.winH)));
        cfg.winX = Math.trunc(numOf(uiSec.get('winX'), cfg.winX));
        cfg.winY = Math.trunc(numOf(uiSec.get('winY'), cfg.winY));
    }
    for (const p of cfg.providers) {
        const sec = ini.get(`provider:${p.id}`);
        if (!sec)
            continue;
        p.name = sec.get('name') ?? p.name;
        const proto = sec.get('proto');
        if (proto && ['openai', 'anthropic', 'gemini', 'ollama'].includes(proto))
            p.proto = proto;
        p.base = sec.get('base') ?? p.base;
        p.model = sec.get('model') ?? p.model;
        p.key = sec.get('key') ?? p.key;
        p.sysPrompt = migratePrompt(sec.get('prompt'), p.sysPrompt);
        p.temp = Math.min(2, Math.max(0, numOf(sec.get('temp'), p.temp)));
        // 0 means "no ceiling" on the reply length. The two values earlier builds shipped as the
        // fixed default (4096 / 8192) are folded into 0 as well, so an existing profile stops
        // truncating answers instead of having to be edited by hand first.
        const tok = Math.trunc(numOf(sec.get('maxTok'), p.maxTok));
        p.maxTok = tok === 4096 || tok === 8192 ? 0 : Math.max(0, tok);
    }
    cfg.legalAccepted = ini.get('app')?.get('legalAccepted') ?? cfg.legalAccepted;
    cfg.onboarded = ini.get('app')?.get('onboarded') ?? cfg.onboarded;
    const bgSec = ini.get('background');
    if (bgSec) {
        cfg.background.file = bgSec.get('file') ?? '';
        const blur = Number(bgSec.get('blur'));
        if (Number.isFinite(blur))
            cfg.background.blur = Math.min(60, Math.max(0, blur));
        const dim = Number(bgSec.get('dim'));
        if (Number.isFinite(dim))
            cfg.background.dim = Math.min(0.9, Math.max(0, dim));
        // the background video plays muted unless this is raised; 0 keeps the old behaviour
        const volume = Number(bgSec.get('volume'));
        if (Number.isFinite(volume))
            cfg.background.volume = Math.min(1, Math.max(0, volume));
        const fit = bgSec.get('fit');
        if (fit === 'cover' || fit === 'contain' || fit === 'tile')
            cfg.background.fit = fit;
    }
    const voiceSec = ini.get('voice');
    if (voiceSec)
        cfg.voice.enabled = boolOf(voiceSec.get('enabled'), cfg.voice.enabled);
    const mediaSec = ini.get('media');
    if (mediaSec) {
        cfg.media.enabled = boolOf(mediaSec.get('enabled'), cfg.media.enabled);
        cfg.media.showChip = boolOf(mediaSec.get('showChip'), cfg.media.showChip);
    }
    const ttsSec = ini.get('tts');
    if (ttsSec) {
        const engine = (ttsSec.get('engine') ?? cfg.tts.engine).toLowerCase();
        if (engine === 'auto' || engine === 'mimo' || engine === 'microsoft')
            cfg.tts.engine = engine;
        cfg.tts.autoRead = boolOf(ttsSec.get('autoRead'), cfg.tts.autoRead);
        cfg.tts.mimoKey = ttsSec.get('mimoKey') ?? cfg.tts.mimoKey;
        cfg.tts.mimoBase = ttsSec.get('mimoBase') || cfg.tts.mimoBase;
        cfg.tts.mimoModel = ttsSec.get('mimoModel') || cfg.tts.mimoModel;
        cfg.tts.mimoVoice = ttsSec.get('mimoVoice') || cfg.tts.mimoVoice;
        cfg.tts.mimoStyle = ttsSec.get('mimoStyle') ?? cfg.tts.mimoStyle;
        cfg.tts.msVoice = ttsSec.get('msVoice') ?? cfg.tts.msVoice;
        cfg.tts.msRate = Math.min(100, Math.max(-50, Math.trunc(numOf(ttsSec.get('msRate'), cfg.tts.msRate))));
    }
    // colour overrides: only a valid six-digit hex is accepted, anything else follows the theme
    for (const mode of ['light', 'dark']) {
        const sec = ini.get(`color:${mode}`);
        if (!sec)
            continue;
        for (const key of palette_1.PALETTE_KEYS) {
            const value = (0, palette_1.normaliseColor)(sec.get(key));
            if (value)
                cfg.colors[mode][key] = value;
        }
    }
    const acSec = ini.get('aicontroller');
    if (acSec) {
        cfg.aiController.enabled = boolOf(acSec.get('enabled'), cfg.aiController.enabled);
    }
    if (cfg.active >= cfg.providers.length)
        cfg.active = 0;
    return cfg;
}
/** A limit: 0 stays 0, meaning no limit; anything else is clamped into a sane range. */
function clampLimit(raw, fallback, max) {
    const value = Math.trunc(numOf(raw, fallback));
    if (value <= 0)
        return 0;
    return Math.min(max, value);
}
/**
 * System prompts written by earlier versions are upgraded in place, so an existing install
 * inherits the new persona. A prompt the user actually edited is left alone - the check is
 * against the exact texts this app has shipped, not a guess at what "looks default".
 */
/** Every system prompt this app has shipped as a default. Used only to recognise stale text. */
const SHIPPED_PROMPTS = [
    'You are DomeOS Team AI Agent, an autonomous coding and operations agent.',
    'You are DomeOS Team AI Agent, an autonomous coding and operations agent running on the',
    'You are a concise, helpful assistant.',
];
function migratePrompt(stored, fallback) {
    if (!stored)
        return fallback;
    const text = stored.trim();
    if (!text || text === 'You are a concise, helpful assistant.')
        return fallback;
    const isShipped = SHIPPED_PROMPTS.some((old) => text.startsWith(old.slice(0, 60)));
    if (isShipped && !text.includes('CETACEA_LOLI'))
        return fallback;
    return stored;
}
function saveConfig(cfg) {
    const lines = [];
    const push = (s = '') => lines.push(s);
    push('; ============================================================');
    push('; DomeOS AI  -  configuration (UTF-8)');
    push('; Saved by the app. API keys stay on this machine only.');
    push('; ============================================================');
    push();
    push('[app]');
    push(`active=${cfg.active}`);
    push(`autostart=${cfg.autostart ? 1 : 0}`);
    push(`notify=${cfg.notify ? 1 : 0}`);
    push(`history=${cfg.history}`);
    push(`language=${cfg.language}`);
    push(`theme=${cfg.theme}`);
    push(`legalAccepted=${cfg.legalAccepted}`);
    push(`onboarded=${cfg.onboarded}`);
    push();
    push('[ui]');
    push(`hotkey=${cfg.hotkey}`);
    push(`showOnStart=${cfg.showOnStart ? 1 : 0}`);
    push(`themePreset=${cfg.themePreset}`);
    push(`ornament=${cfg.ornament}`);
    push(`sidebarWidth=${Math.round(cfg.sidebarWidth)}`);
    push(`winX=${Math.round(cfg.winX)}`);
    push(`winY=${Math.round(cfg.winY)}`);
    push(`winW=${Math.round(cfg.winW)}`);
    push(`winH=${Math.round(cfg.winH)}`);
    push();
    push('[voice]');
    push('; the always-running Windows speech service that answers the wake phrase');
    push(`enabled=${cfg.voice.enabled ? 1 : 0}`);
    push();
    push('[orb]');
    push('; the AI Agent orb: a glowing sphere shown while it thinks');
    push(`enabled=${cfg.orb.enabled ? 1 : 0}`);
    push(`primary=${cfg.orb.primary}`);
    push(`secondary=${cfg.orb.secondary}`);
    push(`size=${cfg.orb.size}`);
    push(`barSize=${cfg.orb.barSize}`);
    push();
    push('[background]');
    push('; a copy of the chosen image lives in the data directory under this name');
    push(`file=${cfg.background.file}`);
    push(`blur=${cfg.background.blur}`);
    push(`dim=${cfg.background.dim}`);
    push(`fit=${cfg.background.fit}`);
    push(`volume=${cfg.background.volume}`);
    push();
    push('[media]');
    push('; control whatever is playing in the background (Windows SMTC)');
    push(`enabled=${cfg.media.enabled ? 1 : 0}`);
    push(`showChip=${cfg.media.showChip ? 1 : 0}`);
    push();
    push('[tts]');
    push('; speech synthesis: MiMo TTS when a key is set, the Windows voices otherwise');
    push(`engine=${cfg.tts.engine}`);
    push(`autoRead=${cfg.tts.autoRead ? 1 : 0}`);
    push(`mimoKey=${cfg.tts.mimoKey}`);
    push(`mimoBase=${cfg.tts.mimoBase}`);
    push(`mimoModel=${cfg.tts.mimoModel}`);
    push(`mimoVoice=${cfg.tts.mimoVoice}`);
    push(`mimoStyle=${cfg.tts.mimoStyle.replace(/[\r\n]+/g, ' ')}`);
    push(`msVoice=${cfg.tts.msVoice}`);
    push(`msRate=${cfg.tts.msRate}`);
    push();
    push('[aicontroller]');
    push('; the bundled AI Controller: when on, the agent may start and stop it');
    push(`enabled=${cfg.aiController.enabled ? 1 : 0}`);
    push();
    // one section per theme, and only the slots the user actually set
    for (const mode of ['light', 'dark']) {
        const own = Object.entries(cfg.colors?.[mode] ?? {}).filter(([, v]) => !!v);
        if (!own.length)
            continue;
        push(`[color:${mode}]`);
        push('; colours the user overrode; a missing key follows the built-in theme');
        for (const [key, value] of own)
            push(`${key}=${value}`);
        push();
    }
    push('[quick]');
    push('; the floating command bar: its hotkey drops an input box on the screen');
    push(`enabled=${cfg.quick.enabled ? 1 : 0}`);
    push(`hotkey=${cfg.quick.hotkey}`);
    push(`hideAfterMs=${cfg.quick.hideAfterMs}`);
    push(`thickness=${cfg.quick.thickness}`);
    push(`color=${cfg.quick.color}`);
    push(`openMain=${cfg.quick.openMain ? 1 : 0}`);
    push();
    push('[agent]');
    push(`enabled=${cfg.agent.enabled ? 1 : 0}`);
    push(`deepThinking=${cfg.agent.deepThinking ? 1 : 0}`);
    push(`webSearch=${cfg.agent.webSearch ? 1 : 0}`);
    push('; workspace = only the workspace folder, machine = every drive');
    push(`scope=${cfg.agent.scope}`);
    push(`autoApprove=${cfg.agent.autoApprove ? 1 : 0}`);
    push(`maxSteps=${cfg.agent.maxSteps}`);
    push(`maxOutput=${cfg.agent.maxOutput}`);
    push(`shellTimeoutMs=${cfg.agent.shellTimeoutMs}`);
    push();
    push('[workspace]');
    push(`root=${cfg.workspace}`);
    for (const p of cfg.providers) {
        push();
        push(`[provider:${p.id}]`);
        push(`name=${p.name}`);
        push(`proto=${p.proto}`);
        push(`base=${p.base}`);
        push(`model=${p.model}`);
        push(`key=${p.key}`);
        push(`temp=${p.temp.toFixed(2)}`);
        push(`maxTok=${p.maxTok}`);
        push(`prompt=${p.sysPrompt.replace(/[\r\n]+/g, ' ')}`);
    }
    const file = getConfigPath();
    const tmp = `${file}.tmp`;
    node_fs_1.default.writeFileSync(tmp, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
    node_fs_1.default.renameSync(tmp, file);
}
function systemPrefersDark() {
    // Electron exposes the OS preference reliably; fall back to the registry value.
    try {
        const { nativeTheme } = require('electron');
        if (nativeTheme && typeof nativeTheme.shouldUseDarkColors === 'boolean') {
            return nativeTheme.shouldUseDarkColors;
        }
    }
    catch {
        /* ignore */
    }
    return true;
}
function openPathSafe(target) {
    const { shell } = require('electron');
    try {
        if (node_fs_1.default.existsSync(target))
            shell.openPath(target);
        else {
            node_fs_1.default.mkdirSync(target, { recursive: true });
            shell.openPath(target);
        }
    }
    catch {
        /* ignore */
    }
}
/**
 * Opens a web link in the user's browser.
 *
 * Only http and https are accepted: an unrestricted pass-through to shell.openExternal would
 * let a page hand us a file:// or a protocol handler that launches a local program.
 */
function openExternalSafe(url) {
    const { shell } = require('electron');
    try {
        const parsed = new URL(String(url));
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return false;
        void shell.openExternal(parsed.toString());
        return true;
    }
    catch {
        return false;
    }
}
function homeDir() {
    return node_os_1.default.homedir();
}
