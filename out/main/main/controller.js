"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveControllerExe = resolveControllerExe;
exports.controllerDir = controllerDir;
exports.resolveConfigSetter = resolveConfigSetter;
exports.configSetterDir = configSetterDir;
exports.describeExitCode = describeExitCode;
exports.readControllerApi = readControllerApi;
exports.syncControllerApi = syncControllerApi;
exports.launchController = launchController;
exports.stopController = stopController;
// src/main/controller.ts - the bundled AI Controller.
//
// "AI Controller" is a separate, autonomous desktop-control program (its own API key, its own
// prompt, its own mouse/keyboard/screen loop). DomeOS AI links to it by shipping it inside the
// installer and by launching or stopping it on the agent's behalf.
//
// It is a tkinter GUI with no documented command line, so the only honest interface is process
// control: start it (its own window asks for a task) and stop it. That is what this module does.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_child_process_1 = require("node:child_process");
const EXE_NAME = 'AI_Controller.exe';
/** sits beside the controller and writes its config.ini from a key it is handed */
const SETTER_NAME = 'config_set.exe';
/**
 * Where the bundled copy is, in order of preference:
 *   1. inside the packaged app (process.resourcesPath/aicontroller),
 *   2. the repo's assets (development),
 *   3. the installed location, as a fallback.
 */
function resolveControllerExe() {
    const candidates = [];
    if (process.resourcesPath) {
        candidates.push(node_path_1.default.join(process.resourcesPath, 'aicontroller', EXE_NAME));
    }
    candidates.push(node_path_1.default.join(__dirname, '..', '..', '..', 'assets', 'aicontroller', EXE_NAME));
    const installed = node_path_1.default.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'AI Controller', EXE_NAME);
    candidates.push(installed);
    // a last resort: the desktop copy the user pointed at
    candidates.push(node_path_1.default.join(node_os_1.default.homedir(), 'Desktop', 'AI Controller Together', EXE_NAME));
    for (const c of candidates) {
        try {
            if (node_fs_1.default.existsSync(c))
                return c;
        }
        catch {
            /* keep looking */
        }
    }
    return null;
}
function controllerDir(exe) {
    return node_path_1.default.dirname(exe);
}
/**
 * The helper that writes the AI Controller's config.
 *
 * It is expected beside the controller, so it is looked for in the same places rather than
 * being hard-wired to one path: whichever copy of the controller is in use, its own setter is
 * the one that should edit its config.
 */
function resolveConfigSetter() {
    const controller = resolveControllerExe();
    const dirs = [];
    if (controller)
        dirs.push(node_path_1.default.dirname(controller));
    if (process.resourcesPath)
        dirs.push(node_path_1.default.join(process.resourcesPath, 'aicontroller'));
    dirs.push(node_path_1.default.join(__dirname, '..', '..', '..', 'assets', 'aicontroller'));
    dirs.push(node_path_1.default.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'AI Controller'));
    dirs.push(node_path_1.default.join(node_os_1.default.homedir(), 'Desktop', 'AI Controller Together'));
    for (const dir of dirs) {
        const candidate = node_path_1.default.join(dir, SETTER_NAME);
        try {
            if (node_fs_1.default.existsSync(candidate))
                return candidate;
        }
        catch {
            /* keep looking */
        }
    }
    return null;
}
/** Where the setter would be looked for, so a missing one can be reported usefully. */
function configSetterDir() {
    const controller = resolveControllerExe();
    if (controller)
        return node_path_1.default.dirname(controller);
    if (process.resourcesPath)
        return node_path_1.default.join(process.resourcesPath, 'aicontroller');
    return null;
}
/**
 * Turns an exit code into the reason behind it.
 *
 * A raw number is useless to the person reading the window, and Windows mixes three encodings
 * in the same field: small Win32 codes for ordinary failures, HRESULTs for shell errors and
 * NTSTATUS values for a crash. Each is named here so the message says what actually happened.
 */
function describeExitCode(code) {
    if (code === null)
        return '没有拿到退出码（进程没有正常结束）';
    const u = code >>> 0;
    const hex = '0x' + u.toString(16).toUpperCase().padStart(8, '0');
    const win32 = {
        0: '成功',
        1: '通用错误（1）：工具报告执行失败但没有给出更具体的原因',
        2: '找不到文件（ERROR_FILE_NOT_FOUND, 2）：-key 指向的内容或它需要的文件不存在',
        3: '找不到路径（ERROR_PATH_NOT_FOUND, 3）',
        5: '拒绝访问（ERROR_ACCESS_DENIED, 5）：需要管理员权限，或 config.ini 正被占用',
        32: '文件被占用（ERROR_SHARING_VIOLATION, 32）：AI Controller 可能正在运行，先停止它再同步',
        87: '参数错误（ERROR_INVALID_PARAMETER, 87）：-key 的值不合法',
        126: '找不到模块（ERROR_MOD_NOT_FOUND, 126）：缺少依赖库',
        193: '不是有效的 Win32 程序（193）：文件损坏或架构不匹配',
        740: '需要提升权限（ERROR_ELEVATION_REQUIRED, 740）：请以管理员身份运行本应用',
        9009: '找不到命令（9009）：系统无法执行该文件',
    };
    if (win32[u])
        return win32[u];
    // NTSTATUS: an unhandled crash inside the tool
    if (u === 0xc0000135)
        return `缺少依赖库（${hex} STATUS_DLL_NOT_FOUND）：目标机器没有它需要的运行库`;
    if (u === 0xc0000005)
        return `访问冲突（${hex} STATUS_ACCESS_VIOLATION）：程序自身崩溃`;
    if (u === 0xc0000142)
        return `DLL 初始化失败（${hex} STATUS_DLL_INIT_FAILED）`;
    if (u === 0xc0000409)
        return `栈保护触发（${hex} STATUS_STACK_BUFFER_OVERRUN）`;
    if (u === 0xc0000374)
        return `堆损坏（${hex} STATUS_HEAP_CORRUPTION）`;
    if (u === 0xc0000017)
        return `内存不足（${hex} STATUS_NO_MEMORY）`;
    // HRESULT: 0x8007xxxx wraps a plain Win32 code. The >>> 0 matters: JavaScript bitwise
    // operators return a SIGNED 32-bit result, so 0x80070005 & 0xffff0000 is negative and would
    // never equal the positive literal.
    if (((u & 0xffff0000) >>> 0) === 0x80070000) {
        const inner = u & 0xffff;
        return `Windows 调用失败（${hex}）：底层错误码 ${inner}${win32[inner] ? `（${win32[inner]}）` : ''}`;
    }
    if (u >= 0x80000000)
        return `异常退出（${hex}）：这是 NTSTATUS/HRESULT 形式的错误码`;
    return `退出码 ${code}（${hex}）`;
}
/**
 * Reads back what is now in the controller's config.ini.
 *
 * This matters because config_set.exe is a GUI-subsystem binary: it prints nothing and, on a
 * bad argument, raises a dialogue box instead of writing to stderr. The file is therefore the
 * only trustworthy evidence that the sync actually happened, and it is what success is judged
 * on - a process that exit-coded 0 without touching the file has not synced anything.
 */
function readControllerApi(dir) {
    try {
        const text = node_fs_1.default.readFileSync(node_path_1.default.join(dir, 'config.ini'), 'utf8');
        const out = { url: '', key: '', model: '' };
        let section = '';
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#') || line.startsWith(';'))
                continue;
            const header = /^\[(.+)\]$/.exec(line);
            if (header) {
                section = header[1].trim().toLowerCase();
                continue;
            }
            if (section !== 'api')
                continue;
            const eq = line.indexOf('=');
            if (eq < 0)
                continue;
            const name = line.slice(0, eq).trim().toLowerCase();
            const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
            if (name === 'api_url')
                out.url = value;
            else if (name === 'api_key')
                out.key = value;
            else if (name === 'model')
                out.model = value;
        }
        return out;
    }
    catch {
        return null;
    }
}
/**
 * Hands the main model's settings to config_set.exe as `-key <base64>`.
 *
 * The payload is `API_URL|API_KEY|MODEL` base64-encoded, exactly as the tool expects. It goes
 * through spawn's argument array rather than a shell, so a key containing spaces, quotes or
 * `&` cannot break the command or leak into a shell's history.
 */
function syncControllerApi(apiUrl, apiKey, model) {
    const exe = resolveConfigSetter();
    const url = String(apiUrl ?? '').trim();
    const key = String(apiKey ?? '');
    const name = String(model ?? '').trim();
    if (!url)
        return { ok: false, code: null, reason: '主模型没有填写 API 地址，无法同步' };
    if (!name)
        return { ok: false, code: null, reason: '主模型没有填写模型名称，无法同步' };
    if (!exe) {
        const dir = configSetterDir();
        return {
            ok: false,
            code: null,
            reason: `没有找到 ${SETTER_NAME}${dir ? `（应在 ${dir}）` : ''}。请把它放在 AI Controller 同目录下。`,
        };
    }
    const payload = Buffer.from(`${url}|${key}|${name}`, 'utf8').toString('base64');
    const dir = node_path_1.default.dirname(exe);
    const before = readControllerApi(dir);
    let run;
    try {
        run = (0, node_child_process_1.spawnSync)(exe, ['-key', payload], {
            cwd: dir,
            windowsHide: true,
            // a GUI binary that hits a validation error raises a dialogue and sits there; this is
            // what stops the window from hanging behind it
            timeout: 20_000,
            encoding: 'utf8',
        });
    }
    catch (e) {
        return { ok: false, code: null, reason: `无法启动 ${SETTER_NAME}：${e?.message ?? e}`, sent: { url, model: name } };
    }
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().slice(0, 2000);
    const code = typeof run.status === 'number' ? run.status : null;
    if (run.error) {
        const err = run.error;
        const reason = err.code === 'ENOENT'
            ? `找不到 ${SETTER_NAME}（${exe}）`
            : err.code === 'EACCES'
                ? `没有权限执行 ${exe}（EACCES）`
                : `启动失败：${err.message}`;
        return { ok: false, code, reason, output, sent: { url, model: name } };
    }
    if (run.signal) {
        return {
            ok: false,
            code: null,
            reason: `${SETTER_NAME} 没有在 20 秒内结束（被 ${run.signal} 中断）。它是图形程序，` +
                `参数不合法时会弹出一个对话框并一直等待——请检查 API 地址、密钥和模型名。`,
            output,
            sent: { url, model: name },
        };
    }
    // The file, not the exit code, decides: the tool is silent, so a zero status on its own
    // proves nothing about whether anything was written.
    const after = readControllerApi(dir);
    if (after && after.url === url && after.model === name && after.key === key) {
        return { ok: true, code, reason: `同步成功，已写入 ${node_path_1.default.join(dir, 'config.ini')}`, output, sent: { url, model: name } };
    }
    if (code !== 0 && code !== null) {
        // The tool is a silent GUI binary, so its own message is unavailable. Exit 1 is the code
        // it uses when its validation or its API probe fails, and saying so is more useful than
        // the bare name of that code.
        const hint = code === 1
            ? '（该工具不输出任何文字，退出码 1 通常意味着它校验 API 地址或密钥失败，或无法连通该地址）'
            : '';
        return { ok: false, code, reason: describeExitCode(code) + hint, output, sent: { url, model: name } };
    }
    // exit 0 (or no code at all) but the file does not agree
    const detail = after
        ? `config.ini 里现在是 url=${after.url || '(空)'} model=${after.model || '(空)'}`
        : 'config.ini 读不出来';
    const unchanged = before && before.url === after?.url && before.model === after?.model;
    return {
        ok: false,
        code,
        reason: `${SETTER_NAME} 结束了（退出码 ${code ?? '未知'}）但没有写入预期内容：${detail}` +
            (unchanged ? '——文件与运行前完全一致。' : '。'),
        output,
        sent: { url, model: name },
    };
}
/**
 * Starts the AI Controller detached, with its working directory set so it picks up the bundled
 * config.ini and system_prompt.txt rather than whichever copy happens to be on the machine.
 */
function launchController() {
    const exe = resolveControllerExe();
    if (!exe) {
        return { ok: false, exe: null, error: 'the bundled AI Controller was not found' };
    }
    try {
        const child = (0, node_child_process_1.spawn)(exe, [], {
            cwd: node_path_1.default.dirname(exe),
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.on('error', () => {
            /* the detached process owns its own lifecycle; nothing to reap here */
        });
        child.unref();
        return { ok: true, exe };
    }
    catch (e) {
        return { ok: false, exe, error: String(e?.message ?? e) };
    }
}
/** Stops every running AI Controller process. */
function stopController() {
    try {
        // taskkill is unambiguous and matches by image name without a window handle
        (0, node_child_process_1.spawnSync)('taskkill', ['/F', '/IM', EXE_NAME], { windowsHide: true, stdio: 'ignore' });
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}
