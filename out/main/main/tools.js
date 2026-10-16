"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathError = exports.MAX_WRITE_BYTES = exports.MAX_READ_BYTES = void 0;
exports.toolSpecs = toolSpecs;
exports.resolvePath = resolvePath;
exports.resolveToolPath = resolveToolPath;
exports.resolveInWorkspace = resolveInWorkspace;
exports.globToRegExp = globToRegExp;
exports.executeTool = executeTool;
exports.workspaceTree = workspaceTree;
// src/main/tools.ts - the agent's hands: files, search, shell and the web.
//
// Every path is resolved against the active workspace and rejected if it escapes, so
// "full control" still means "full control of the folder you pointed me at".
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_child_process_1 = require("node:child_process");
const websearch_1 = require("./websearch");
const controller_1 = require("./controller");
exports.MAX_READ_BYTES = 400_000;
exports.MAX_WRITE_BYTES = 4_000_000;
const SKIP_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'release',
    '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', '.idea', '.vscode',
    'target', 'bin', 'obj', '.gradle', '.dart_tool', 'coverage',
]);
const BINARY_EXT = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz', '.pdf', '.zip',
    '.7z', '.rar', '.gz', '.tar', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
    '.mp3', '.mp4', '.avi', '.mkv', '.wav', '.flac', '.woff', '.woff2', '.ttf', '.otf',
    '.class', '.jar', '.pyc', '.o', '.obj', '.lib', '.pdb', '.sqlite', '.db',
]);
function toolSpecs(scope = 'workspace', web = true, aiController = false) {
    const machine = scope === 'machine';
    // the descriptions tell the model how far it may reach, so they follow the setting
    const file = machine ? 'Any absolute path on this computer' : 'Path relative to the workspace';
    const folder = machine ? 'Any absolute folder on this computer' : 'Folder relative to the workspace';
    const folderOpt = `${folder}. Optional`;
    return [
        {
            name: 'list_dir',
            title: 'List folder',
            description: 'List the files and folders at a path inside the workspace.',
            dangerous: false,
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: folder + '. Default the workspace root' },
                    depth: { type: 'integer', description: 'How deep to recurse, 1-4. Default 1' },
                    limit: { type: 'integer', description: 'Maximum entries, default 400' },
                },
                required: [],
            },
        },
        {
            name: 'read_file',
            title: 'Read file',
            description: 'Read a text file. Output is numbered by line so you can edit precisely.',
            dangerous: false,
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: file },
                    start: { type: 'integer', description: 'First line, 1-based. Optional' },
                    lines: { type: 'integer', description: 'How many lines to read. Optional' },
                },
                required: ['path'],
            },
        },
        {
            name: 'write_file',
            title: 'Write file',
            description: 'Create a file or replace it completely. Parent folders are created.',
            dangerous: true,
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: file },
                    content: { type: 'string', description: 'The full new content' },
                },
                required: ['path', 'content'],
            },
        },
        {
            name: 'replace_in_file',
            title: 'Edit file',
            description: 'Replace an exact snippet in a file. Fails when the snippet is missing or ambiguous.',
            dangerous: true,
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: file },
                    find: { type: 'string', description: 'Exact text to replace' },
                    replace: { type: 'string', description: 'Replacement text' },
                    all: { type: 'boolean', description: 'Replace every occurrence. Default false' },
                },
                required: ['path', 'find', 'replace'],
            },
        },
        {
            name: 'make_dir',
            title: 'Create folder',
            description: 'Create a folder, including missing parents.',
            dangerous: true,
            parameters: {
                type: 'object',
                properties: { path: { type: 'string', description: folder } },
                required: ['path'],
            },
        },
        {
            name: 'move_path',
            title: 'Move / rename',
            description: 'Move or rename a file or folder inside the workspace.',
            dangerous: true,
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                },
                required: ['from', 'to'],
            },
        },
        {
            name: 'delete_path',
            title: 'Delete',
            description: 'Delete a file or folder. This cannot be undone.',
            dangerous: true,
            parameters: {
                type: 'object',
                properties: { path: { type: 'string', description: 'Path relative to the workspace' } },
                required: ['path'],
            },
        },
        {
            name: 'find_files',
            title: 'Find files',
            description: 'Find files by glob pattern, for example "**/*.ts" or "src/*.json".',
            dangerous: false,
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Glob, ** matches any depth' },
                    path: { type: 'string', description: folderOpt },
                    limit: { type: 'integer', description: 'Maximum results, default 80' },
                },
                required: ['pattern'],
            },
        },
        {
            name: 'search_text',
            title: 'Search in files',
            description: 'Search file contents with a regular expression and return matching lines.',
            dangerous: false,
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Regular expression' },
                    glob: { type: 'string', description: 'Optional file filter, e.g. "*.ts"' },
                    path: { type: 'string', description: folderOpt },
                    limit: { type: 'integer', description: 'Maximum matches, default 60' },
                },
                required: ['query'],
            },
        },
        {
            name: 'run_command',
            title: 'Run command',
            description: 'Run a shell command inside the workspace and capture its output. ' +
                'On Windows this uses PowerShell when available, otherwise cmd.exe.',
            dangerous: true,
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The command line to run' },
                    cwd: { type: 'string', description: folderOpt },
                    timeoutMs: { type: 'integer', description: 'Timeout in milliseconds, default 60000' },
                },
                required: ['command'],
            },
        },
        {
            name: 'web_search',
            title: 'Search the web',
            description: 'Search the internet and return the top results with their titles, URLs and snippets. ' +
                'Use this whenever you need current facts, documentation or news, then read a result ' +
                'with fetch_url to get the details.',
            dangerous: false,
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'What to search for' },
                    limit: { type: 'integer', description: 'How many results, default 6, maximum 12' },
                },
                required: ['query'],
            },
        },
        {
            name: 'fetch_url',
            title: 'Read a web page',
            description: 'Download a URL and return it as readable text, with links kept inline as [label](url). ' +
                'Works for HTML pages and JSON APIs.',
            dangerous: false,
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'http or https URL' },
                    maxChars: { type: 'integer', description: 'Text budget, default 20000' },
                },
                required: ['url'],
            },
        },
        ...(aiController
            ? [{
                    name: 'ai_controller',
                    title: 'AI Controller',
                    description: 'Start or stop the bundled AI Controller, a separate autonomous program that drives ' +
                        'the mouse, keyboard and screen to finish a task on its own. Start it when the job ' +
                        'needs hands-on desktop automation; it opens its own window and runs its own loop.',
                    dangerous: true,
                    parameters: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                description: "'start' to launch it, 'stop' to quit every running copy",
                                enum: ['start', 'stop'],
                            },
                        },
                        required: ['action'],
                    },
                }]
            : []),
    ].filter((spec) => web || (spec.name !== 'web_search' && spec.name !== 'fetch_url'));
}
// ------------------------------------------------------------------ path safety
class PathError extends Error {
}
exports.PathError = PathError;
/** Turns whatever the model passed into an absolute path. */
function resolvePath(ctx, p) {
    const raw = (p ?? '').trim();
    if (!raw)
        return node_path_1.default.resolve(ctx.workspace);
    if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
        return node_path_1.default.resolve(node_os_1.default.homedir(), raw.slice(1).replace(/^[\\/]/, ''));
    }
    return node_path_1.default.isAbsolute(raw) ? node_path_1.default.resolve(raw) : node_path_1.default.resolve(ctx.workspace, raw);
}
/**
 * Resolves a tool path. In workspace scope anything outside the workspace is refused;
 * in machine scope absolute paths anywhere on the computer are allowed.
 */
function resolveToolPath(ctx, p) {
    const target = resolvePath(ctx, p);
    if (ctx.scope === 'machine')
        return target;
    const root = node_path_1.default.resolve(ctx.workspace);
    const withSep = root.endsWith(node_path_1.default.sep) ? root : root + node_path_1.default.sep;
    if (target !== root && !target.startsWith(withSep)) {
        throw new PathError(`"${p}" is outside the workspace (${ctx.workspace}). ` +
            'Switch the permission to whole-computer access if you really mean it.');
    }
    return target;
}
/** Kept for callers that always want the jail (the self test uses it). */
function resolveInWorkspace(ctx, rel) {
    return resolveToolPath({ ...ctx, scope: 'workspace' }, rel);
}
function rel(ctx, abs) {
    const r = node_path_1.default.relative(node_path_1.default.resolve(ctx.workspace), abs);
    // machine scope can point far outside the workspace; show an absolute path then
    if (r.startsWith('..') || node_path_1.default.isAbsolute(r))
        return abs;
    return r === '' ? '.' : r.split(node_path_1.default.sep).join('/');
}
/** The nearest drive or share root, e.g. C:\ - never a valid thing to delete. */
function isVolumeRoot(target) {
    const resolved = node_path_1.default.resolve(target);
    return node_path_1.default.dirname(resolved) === resolved;
}
// ------------------------------------------------------------------ helpers
function isProbablyBinary(file) {
    if (BINARY_EXT.has(node_path_1.default.extname(file).toLowerCase()))
        return true;
    try {
        const fd = node_fs_1.default.openSync(file, 'r');
        const buf = Buffer.alloc(512);
        const n = node_fs_1.default.readSync(fd, buf, 0, 512, 0);
        node_fs_1.default.closeSync(fd);
        for (let i = 0; i < n; i++)
            if (buf[i] === 0)
                return true;
    }
    catch {
        /* unreadable counts as binary for our purposes */
    }
    return false;
}
function truncate(text, limit) {
    if (text.length <= limit)
        return { text, cut: false };
    return { text: text.slice(0, limit), cut: true };
}
function* walk(dir, depth, budget) {
    if (budget.n <= 0)
        return;
    let entries;
    try {
        entries = node_fs_1.default.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
        if (budget.n-- <= 0)
            return;
        if (e.name.startsWith('.') && SKIP_DIRS.has(e.name))
            continue;
        if (e.isDirectory() && SKIP_DIRS.has(e.name))
            continue;
        const abs = node_path_1.default.join(dir, e.name);
        yield { abs, dir: e.isDirectory(), depth };
        if (e.isDirectory() && depth > 1)
            yield* walk(abs, depth - 1, budget);
    }
}
/** Tiny glob matcher: *, ?, ** and [abc]. */
function globToRegExp(pattern) {
    const norm = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    let out = '';
    for (let i = 0; i < norm.length; i++) {
        const c = norm[i];
        if (c === '*') {
            if (norm[i + 1] === '*') {
                i++;
                if (norm[i + 1] === '/')
                    i++;
                out += '(?:.*/)?';
            }
            else {
                out += '[^/]*';
            }
        }
        else if (c === '?')
            out += '[^/]';
        else if (c === '[') {
            const end = norm.indexOf(']', i);
            if (end > i) {
                out += norm.slice(i, end + 1);
                i = end;
            }
            else
                out += '\\[';
        }
        else
            out += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
    return new RegExp(`^${out}$`, 'i');
}
function looksLikeGlob(pattern) {
    return /[*?[\]]/.test(pattern);
}
// ------------------------------------------------------------------ execution
async function run(ctx, call) {
    const a = call.args;
    // 0 in the settings means no output cap: a generous ceiling instead of a tight one
    const limit = ctx.maxOutput > 0 ? ctx.maxOutput : 400_000;
    switch (call.name) {
        case 'list_dir': {
            const base = resolveToolPath(ctx, String(a.path ?? '.'));
            if (!node_fs_1.default.existsSync(base))
                return { summary: `not found: ${a.path}`, ok: false };
            const st = node_fs_1.default.statSync(base);
            if (!st.isDirectory())
                return { summary: `${a.path} is a file`, ok: false };
            const depth = Math.min(4, Math.max(1, Number(a.depth) || 1));
            const cap = Math.min(2000, Math.max(1, Number(a.limit) || 400));
            const lines = [];
            const budget = { n: cap + 1 };
            for (const item of walk(base, depth, budget)) {
                if (lines.length >= cap) {
                    lines.push('… more entries were hidden');
                    break;
                }
                const size = item.dir ? '' : ` (${node_fs_1.default.statSync(item.abs).size}b)`;
                lines.push(`${item.dir ? 'd' : '-'} ${rel(ctx, item.abs)}${size}`);
            }
            if (!lines.length)
                lines.push('(empty folder)');
            return { summary: `${lines.length} entries under ${rel(ctx, base)}`, ok: true, output: lines.join('\n') };
        }
        case 'read_file': {
            const file = resolveToolPath(ctx, String(a.path ?? ''));
            if (!node_fs_1.default.existsSync(file))
                return { summary: `not found: ${a.path}`, ok: false };
            const st = node_fs_1.default.statSync(file);
            if (st.isDirectory())
                return { summary: `${a.path} is a folder`, ok: false };
            if (isProbablyBinary(file))
                return { summary: `${a.path} looks binary (${st.size} bytes)`, ok: false };
            const raw = node_fs_1.default.readFileSync(file).subarray(0, exports.MAX_READ_BYTES).toString('utf8');
            const cut = st.size > exports.MAX_READ_BYTES;
            const all = raw.split(/\r?\n/);
            const start = Math.max(1, Number(a.start) || 1);
            const count = Math.max(1, Math.min(20_000, Number(a.lines) || all.length));
            const slice = all.slice(start - 1, start - 1 + count);
            const numbered = slice.map((l, i) => `${String(start + i).padStart(5)}| ${l}`).join('\n');
            const tail = cut ? `\n… file truncated at ${exports.MAX_READ_BYTES} bytes` : '';
            return {
                summary: `${rel(ctx, file)} lines ${start}-${start + slice.length - 1} of ${all.length}`,
                ok: true,
                output: numbered + tail,
            };
        }
        case 'write_file': {
            const file = resolveToolPath(ctx, String(a.path ?? ''));
            const content = String(a.content ?? '');
            if (Buffer.byteLength(content, 'utf8') > exports.MAX_WRITE_BYTES) {
                return { summary: `refusing to write ${(content.length / 1e6).toFixed(1)} MB`, ok: false };
            }
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
            const existed = node_fs_1.default.existsSync(file);
            node_fs_1.default.writeFileSync(file, content, 'utf8');
            return {
                summary: `${existed ? 'overwrote' : 'created'} ${rel(ctx, file)} (${content.length} chars, ${content.split('\n').length} lines)`,
                ok: true,
            };
        }
        case 'replace_in_file': {
            const file = resolveToolPath(ctx, String(a.path ?? ''));
            if (!node_fs_1.default.existsSync(file))
                return { summary: `not found: ${a.path}`, ok: false };
            const old = node_fs_1.default.readFileSync(file, 'utf8');
            const find = String(a.find ?? '');
            const repl = String(a.replace ?? '');
            if (!find)
                return { summary: 'the "find" text is empty', ok: false };
            const parts = old.split(find);
            const hits = parts.length - 1;
            if (hits === 0)
                return { summary: `the snippet was not found in ${a.path}`, ok: false };
            if (hits > 1 && !a.all) {
                return { summary: `the snippet appears ${hits} times in ${a.path}; pass all=true or make it unique`, ok: false };
            }
            const next = a.all ? parts.join(repl) : old.replace(find, repl);
            node_fs_1.default.writeFileSync(file, next, 'utf8');
            return { summary: `${hits > 1 ? `${hits} replacements` : '1 replacement'} in ${rel(ctx, file)}`, ok: true };
        }
        case 'make_dir': {
            const dir = resolveToolPath(ctx, String(a.path ?? ''));
            node_fs_1.default.mkdirSync(dir, { recursive: true });
            return { summary: `folder ready: ${rel(ctx, dir)}`, ok: true };
        }
        case 'move_path': {
            const from = resolveToolPath(ctx, String(a.from ?? ''));
            const to = resolveToolPath(ctx, String(a.to ?? ''));
            if (!node_fs_1.default.existsSync(from))
                return { summary: `not found: ${a.from}`, ok: false };
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(to), { recursive: true });
            node_fs_1.default.renameSync(from, to);
            return { summary: `${rel(ctx, from)} -> ${rel(ctx, to)}`, ok: true };
        }
        case 'delete_path': {
            const target = resolveToolPath(ctx, String(a.path ?? ''));
            const root = node_path_1.default.resolve(ctx.workspace);
            if (target === root)
                return { summary: 'refusing to delete the workspace root', ok: false };
            if (isVolumeRoot(target)) {
                return { summary: `refusing to delete a whole drive (${target})`, ok: false };
            }
            if (!node_fs_1.default.existsSync(target))
                return { summary: `not found: ${a.path}`, ok: false };
            node_fs_1.default.rmSync(target, { recursive: true, force: true });
            return { summary: `deleted ${rel(ctx, target)}`, ok: true };
        }
        case 'find_files': {
            const pattern = String(a.pattern ?? '**/*');
            const re = globToRegExp(pattern);
            const cap = Math.min(500, Math.max(1, Number(a.limit) || 80));
            const found = [];
            const budget = { n: 20_000 };
            const from = a.path ? resolveToolPath(ctx, String(a.path)) : node_path_1.default.resolve(ctx.workspace);
            if (!node_fs_1.default.existsSync(from))
                return { summary: `not found: ${String(a.path)}`, ok: false };
            for (const item of walk(from, 12, budget)) {
                if (item.dir)
                    continue;
                const r = rel(ctx, item.abs);
                if (re.test(r) || re.test(node_path_1.default.basename(r))) {
                    found.push(r);
                    if (found.length >= cap)
                        break;
                }
            }
            return {
                summary: `${found.length} file${found.length === 1 ? '' : 's'} matched ${pattern}`,
                ok: true,
                output: found.length ? found.join('\n') : '(nothing matched)',
            };
        }
        case 'search_text': {
            const query = String(a.query ?? '');
            if (!query)
                return { summary: 'empty query', ok: false };
            let re;
            try {
                re = new RegExp(query, 'i');
            }
            catch (e) {
                return { summary: `bad regular expression: ${e?.message ?? e}`, ok: false };
            }
            const fileFilter = a.glob ? globToRegExp(String(a.glob)) : null;
            const cap = Math.min(400, Math.max(1, Number(a.limit) || 60));
            const out = [];
            const budget = { n: 20_000 };
            const from = a.path ? resolveToolPath(ctx, String(a.path)) : node_path_1.default.resolve(ctx.workspace);
            if (!node_fs_1.default.existsSync(from))
                return { summary: `not found: ${String(a.path)}`, ok: false };
            for (const item of walk(from, 12, budget)) {
                if (item.dir || isProbablyBinary(item.abs))
                    continue;
                const r = rel(ctx, item.abs);
                if (fileFilter && !fileFilter.test(r) && !fileFilter.test(node_path_1.default.basename(r)))
                    continue;
                let text;
                try {
                    const st = node_fs_1.default.statSync(item.abs);
                    if (st.size > 1_500_000)
                        continue;
                    text = node_fs_1.default.readFileSync(item.abs, 'utf8');
                }
                catch {
                    continue;
                }
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    if (re.test(lines[i])) {
                        out.push(`${r}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
                        if (out.length >= cap)
                            break;
                    }
                }
                if (out.length >= cap)
                    break;
            }
            return {
                summary: `${out.length} match${out.length === 1 ? '' : 'es'} for /${query}/`,
                ok: true,
                output: out.length ? out.join('\n') : '(no matches)',
            };
        }
        case 'run_command': {
            const command = String(a.command ?? '').trim();
            if (!command)
                return { summary: 'empty command', ok: false };
            const cwd = a.cwd ? resolveToolPath(ctx, String(a.cwd)) : node_path_1.default.resolve(ctx.workspace);
            if (!node_fs_1.default.existsSync(cwd))
                return { summary: `working folder not found: ${a.cwd}`, ok: false };
            // 0 in the settings means no timeout: pass 0 through rather than clamping it to a minimum
            const requested = Number(a.timeoutMs) || ctx.shellTimeoutMs;
            const timeout = requested > 0 ? Math.min(600_000, Math.max(1000, requested)) : 0;
            return await runShell(command, cwd, timeout, limit);
        }
        case 'web_search': {
            const query = String(a.query ?? '').trim();
            if (!query)
                return { summary: 'empty query', ok: false };
            const count = Math.min(12, Math.max(1, Number(a.limit) || 6));
            const result = await (0, websearch_1.webSearch)(query, count);
            if (!result.ok)
                return { summary: `search failed: ${result.error}`, ok: false };
            const lines = result.hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`);
            return {
                summary: `${result.hits.length} results from ${result.engine} for "${query}"`,
                ok: true,
                output: lines.join('\n\n'),
            };
        }
        case 'fetch_url': {
            const url = String(a.url ?? '');
            if (!/^https?:\/\//i.test(url))
                return { summary: 'only http and https URLs are supported', ok: false };
            const budget = Math.min(80_000, Math.max(2000, Number(a.maxChars) || Math.min(30_000, limit)));
            const page = await (0, websearch_1.readPage)(url, budget);
            if (page.error)
                return { summary: `could not fetch ${url}: ${page.error}`, ok: false };
            return {
                summary: `${page.status} ${page.title} (${page.text.length} chars)`,
                ok: page.ok,
                output: page.text,
            };
        }
        case 'ai_controller': {
            if (!ctx.aiController)
                return { summary: 'the AI Controller integration is disabled', ok: false };
            const action = String(a.action ?? '').toLowerCase();
            if (action === 'stop') {
                const r = (0, controller_1.stopController)();
                return r.ok
                    ? { summary: 'AI Controller stopped', ok: true }
                    : { summary: `could not stop the AI Controller: ${r.error}`, ok: false };
            }
            if (action !== 'start')
                return { summary: `unknown action "${a.action}"; use start or stop`, ok: false };
            const r = (0, controller_1.launchController)();
            if (!r.ok)
                return { summary: `could not start the AI Controller: ${r.error}`, ok: false };
            return {
                summary: `AI Controller started (${r.exe}). Its window asks for a task and runs it on its own.`,
                ok: true,
            };
        }
        default:
            return { summary: `unknown tool "${call.name}"`, ok: false };
    }
}
function runShell(command, cwd, timeoutMs, limit) {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const shell = isWin ? 'powershell.exe' : '/bin/sh';
        const args = isWin
            ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
            : ['-c', command];
        let child;
        try {
            child = (0, node_child_process_1.spawn)(shell, args, { cwd, windowsHide: true, env: { ...process.env } });
        }
        catch (e) {
            resolve({ summary: `could not start the shell: ${e?.message ?? e}`, ok: false });
            return;
        }
        let out = '';
        let err = '';
        let killed = false;
        // timeoutMs 0 means the caller asked for no timeout: no timer is armed at all
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                killed = true;
                try {
                    child.kill();
                }
                catch {
                    /* ignore */
                }
            }, timeoutMs)
            : null;
        child.stdout?.on('data', (b) => {
            if (out.length < limit)
                out += b.toString('utf8');
        });
        child.stderr?.on('data', (b) => {
            if (err.length < limit)
                err += b.toString('utf8');
        });
        child.on('error', (e) => {
            if (timer)
                clearTimeout(timer);
            resolve({ summary: `shell error: ${e.message}`, ok: false });
        });
        child.on('close', (code) => {
            if (timer)
                clearTimeout(timer);
            const merged = [`$ ${command}`, `exit ${code}${killed ? ` (killed after ${timeoutMs} ms)` : ''}`, ''];
            if (out.trim())
                merged.push(out.trimEnd());
            if (err.trim())
                merged.push('', '[stderr]', err.trimEnd());
            const { text, cut } = truncate(merged.join('\n'), limit);
            resolve({
                summary: killed ? `timed out after ${timeoutMs} ms` : `exit ${code}`,
                ok: code === 0 && !killed,
                output: text + (cut ? '\n[output truncated]' : ''),
            });
        });
    });
}
/** Runs one tool call and turns the outcome into text for the model. */
async function executeTool(ctx, call) {
    try {
        const r = await run(ctx, call);
        return {
            ok: r.ok,
            summary: r.summary,
            text: r.output ? `${r.summary}\n\n${r.output}` : r.summary,
        };
    }
    catch (e) {
        const message = e instanceof PathError ? e.message : `${e?.name ?? 'error'}: ${e?.message ?? e}`;
        return { ok: false, summary: message, text: message };
    }
}
/** A shallow listing for the UI workspace panel. */
function workspaceTree(root, depth = 3, cap = 600) {
    const out = [];
    if (!root || !node_fs_1.default.existsSync(root))
        return out;
    const budget = { n: cap };
    const build = (dir, level) => {
        const nodes = [];
        let entries;
        try {
            entries = node_fs_1.default.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return nodes;
        }
        entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        for (const e of entries) {
            if (budget.n-- <= 0)
                return nodes;
            if (SKIP_DIRS.has(e.name))
                continue;
            if (e.name.startsWith('.') && e.name.length > 1 && !['.env', '.gitignore', '.editorconfig'].includes(e.name))
                continue;
            const abs = node_path_1.default.join(dir, e.name);
            const node = {
                name: e.name,
                path: abs,
                dir: e.isDirectory(),
            };
            if (e.isDirectory()) {
                if (level < depth)
                    node.children = build(abs, level + 1);
            }
            else {
                try {
                    node.size = node_fs_1.default.statSync(abs).size;
                }
                catch {
                    /* ignore */
                }
            }
            nodes.push(node);
        }
        return nodes;
    };
    out.push(...build(root, 1));
    return out;
}
