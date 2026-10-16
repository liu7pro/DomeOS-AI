"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listThreads = listThreads;
exports.getThread = getThread;
exports.saveThread = saveThread;
exports.deleteThread = deleteThread;
exports.renameThread = renameThread;
exports.flushStore = flushStore;
exports.titleFrom = titleFrom;
// src/main/store.ts - conversations, persisted as JSON beside the config
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const FILE = 'threads.json';
const MAX_THREADS = 200;
function storePath() {
    return node_path_1.default.join((0, config_1.getDataDir)(), FILE);
}
function read() {
    try {
        const raw = node_fs_1.default.readFileSync(storePath(), 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.threads))
            throw new Error('bad shape');
        return { version: 1, threads: parsed.threads };
    }
    catch {
        return { version: 1, threads: [] };
    }
}
let cache = null;
let flushTimer = null;
function data() {
    if (!cache)
        cache = read();
    return cache;
}
function flushNow() {
    if (!cache)
        return;
    try {
        const file = storePath();
        const tmp = file + '.tmp';
        cache.threads.sort((a, b) => b.updated - a.updated);
        if (cache.threads.length > MAX_THREADS)
            cache.threads = cache.threads.slice(0, MAX_THREADS);
        node_fs_1.default.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
        node_fs_1.default.renameSync(tmp, file);
    }
    catch {
        /* a read-only profile must not break the app */
    }
}
/** Writes are debounced: the renderer saves after every message. */
function scheduleFlush() {
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushNow();
    }, 400);
}
function listThreads() {
    return data()
        .threads.map((t) => ({
        id: t.id,
        title: t.title,
        created: t.created,
        updated: t.updated,
        messages: t.items?.length ?? 0,
    }))
        .sort((a, b) => b.updated - a.updated);
}
function getThread(id) {
    return data().threads.find((t) => t.id === id) ?? null;
}
function saveThread(thread) {
    const store = data();
    const idx = store.threads.findIndex((t) => t.id === thread.id);
    const clean = {
        id: thread.id,
        title: (thread.title || 'New chat').slice(0, 120),
        created: thread.created || Date.now(),
        updated: Date.now(),
        workspace: thread.workspace,
        wire: Array.isArray(thread.wire) ? thread.wire : [],
        items: Array.isArray(thread.items) ? thread.items : [],
    };
    if (idx >= 0)
        store.threads[idx] = clean;
    else
        store.threads.unshift(clean);
    scheduleFlush();
}
function deleteThread(id) {
    const store = data();
    store.threads = store.threads.filter((t) => t.id !== id);
    scheduleFlush();
    return listThreads();
}
function renameThread(id, title) {
    const t = data().threads.find((x) => x.id === id);
    if (t) {
        t.title = (title || 'New chat').slice(0, 120);
        t.updated = Date.now();
        scheduleFlush();
    }
    return listThreads();
}
function flushStore() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    flushNow();
}
/** A short, human title derived from the first user line. */
function titleFrom(text) {
    if (Array.isArray(text))
        text = text.filter((p) => p && p.type === 'text').map((p) => p.text ?? '').join(' ');
    text = String(text ?? '');
    const first = text.trim().split(/\r?\n/)[0] ?? '';
    const clean = first.replace(/^[#>\-*\s]+/, '').trim();
    if (!clean)
        return 'New chat';
    return clean.length > 46 ? clean.slice(0, 45) + '…' : clean;
}
