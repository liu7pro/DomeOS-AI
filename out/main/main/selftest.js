"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSelfTestLog = setSelfTestLog;
exports.runSelfTest = runSelfTest;
// src/main/selftest.ts - in-app verification, run with:  electron . --selftest
//
// Exercises the request builders, the tool layer, the conversation store and a full
// configuration round-trip inside a real Electron main process.
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const providers_1 = require("./providers");
const tools_1 = require("./tools");
const agent_1 = require("./agent");
const language_1 = require("./language");
const store_1 = require("./store");
let failures = 0;
let sink = null;
/** A packaged Windows build has no console, so --log=<file> mirrors the output. */
function setSelfTestLog(file) {
    try {
        node_fs_1.default.writeFileSync(file, '\uFEFF', 'utf8');
        sink = (line) => node_fs_1.default.appendFileSync(file, line + '\n', 'utf8');
    }
    catch {
        sink = null;
    }
}
function say(line) {
    process.stdout.write(line + '\n');
    if (sink)
        sink(line);
}
function ok(cond, what, detail = '') {
    say(`[${cond ? ' ok ' : 'FAIL'}] ${what}${detail ? '  ->  ' + detail : ''}`);
    if (!cond)
        failures++;
}
const p = (over = {}) => ({
    id: 'x', name: 'x', proto: 'openai', base: 'https://api.example.com/v1', model: 'm',
    key: 'k', sysPrompt: 'sys', temp: 0.7, maxTok: 128, ...over,
});
const call = (name, args) => ({
    id: 'c1', name, args, title: name, dangerous: false,
});
/** Kicks the suite off; it exits the process with the right code when done. */
function runSelfTest() {
    say('');
    say('=== DomeOS Team AI Agent self test (electron) ===');
    // ------------------------------------------------------------ requests
    say('');
    say('--- request building ---');
    {
        const r = (0, providers_1.buildChatRequest)(p(), [{ role: 'user', content: 'hi' }]);
        ok(r.url === 'https://api.example.com/v1/chat/completions', 'openai path', r.url);
        const body = JSON.parse(r.body);
        ok(body.stream === true && body.messages[0].role === 'system', 'openai streams + system prompt');
        ok(r.headers.Authorization === 'Bearer k', 'openai bearer header');
    }
    {
        const r = (0, providers_1.buildChatRequest)(p({ proto: 'anthropic', base: 'https://api.anthropic.com/v1' }), [{ role: 'user', content: 'hi' }]);
        ok(r.url === 'https://api.anthropic.com/v1/messages', 'anthropic path', r.url);
        ok(r.headers['anthropic-version'] === '2023-06-01', 'anthropic version header');
    }
    {
        const r = (0, providers_1.buildChatRequest)(p({ proto: 'gemini', base: 'https://g/v1beta', key: 'zz' }), [{ role: 'user', content: 'hi' }]);
        ok(r.url.includes(':streamGenerateContent?alt=sse'), 'gemini sse path');
        ok(!r.safeUrl.includes('key='), 'gemini key stays out of the logged url');
    }
    {
        const r = (0, providers_1.buildChatRequest)(p({ proto: 'ollama', base: 'http://127.0.0.1:11434' }), [{ role: 'user', content: 'hi' }]);
        ok(r.url === 'http://127.0.0.1:11434/api/chat', 'ollama path', r.url);
    }
    // ------------------------------------------------------------ tool wiring
    say('');
    say('--- tool wiring ---');
    const specs = (0, tools_1.toolSpecs)();
    {
        ok(specs.length >= 10, 'tool catalog', `${specs.length} tools`);
        ok(specs.some((s) => s.name === 'run_command' && s.dangerous), 'run_command exists and is dangerous');
        ok(specs.some((s) => s.name === 'read_file' && !s.dangerous), 'read_file is safe');
        const openai = JSON.parse((0, providers_1.buildChatRequest)(p(), [{ role: 'user', content: 'x' }], specs).body);
        ok(openai.tools?.length === specs.length, 'openai receives every tool');
        ok(openai.tools[0].type === 'function' && typeof openai.tools[0].function.name === 'string', 'openai tool shape');
        const anth = JSON.parse((0, providers_1.buildChatRequest)(p({ proto: 'anthropic' }), [{ role: 'user', content: 'x' }], specs).body);
        ok(anth.tools?.[0].input_schema?.type === 'object', 'anthropic tool shape');
        const gem = JSON.parse((0, providers_1.buildChatRequest)(p({ proto: 'gemini' }), [{ role: 'user', content: 'x' }], specs).body);
        ok(gem.tools?.[0].functionDeclarations?.length === specs.length, 'gemini declarations');
        ok(gem.tools[0].functionDeclarations[0].parameters.type === 'OBJECT', 'gemini uses its own type names');
    }
    {
        const wire = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'read it' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }] },
            { role: 'tool', content: 'hello', tool_call_id: 'c1', name: 'read_file' },
        ];
        const openai = JSON.parse((0, providers_1.buildChatRequest)(p(), wire, specs).body);
        ok(openai.messages[0].role === 'system', 'the system turn is first');
        ok(openai.messages[2].tool_calls[0].function.name === 'read_file', 'openai replays tool calls');
        ok(openai.messages[3].tool_call_id === 'c1', 'openai replays tool results');
        const anth = JSON.parse((0, providers_1.buildChatRequest)(p({ proto: 'anthropic' }), wire, specs).body);
        ok(anth.messages[1].content[0].type === 'tool_use', 'anthropic replays tool_use');
        ok(anth.messages[2].content[0].type === 'tool_result', 'anthropic replays tool_result');
        ok(!anth.messages.some((m) => m.role === 'system'), 'anthropic keeps the system prompt top level');
        const gem = JSON.parse((0, providers_1.buildChatRequest)(p({ proto: 'gemini' }), wire, specs).body);
        ok(gem.contents[1].parts[0].functionCall.name === 'read_file', 'gemini replays functionCall');
        ok(gem.contents[2].parts[0].functionResponse.name === 'read_file', 'gemini replays functionResponse');
        ok(!gem.contents.some((c) => c.role === 'system'), 'gemini keeps the system prompt top level');
    }
    // ------------------------------------------------------------ errors
    say('');
    say('--- error handling ---');
    ok((0, providers_1.extractErrorMessage)('openai', '{"error":{"message":"Insufficient Balance"}}') === 'Insufficient Balance', 'plain json error body');
    ok((0, providers_1.extractErrorMessage)('openai', 'data: {"error":{"message":"bad key"}}\n\n') === 'bad key', 'sse wrapped error body');
    ok((0, providers_1.hintForStatus)(401) === 'err.key' && (0, providers_1.hintForStatus)(503) === 'err.server', 'status -> hint mapping');
    // ------------------------------------------------------------ the tool layer
    say('');
    say('--- glob and the path jail ---');
    ok((0, tools_1.globToRegExp)('**/*.ts').test('src/main/a.ts'), 'glob **/*.ts matches a nested file');
    ok((0, tools_1.globToRegExp)('**/*.ts').test('a.ts'), 'glob **/*.ts matches a top-level file');
    ok(!(0, tools_1.globToRegExp)('**/*.ts').test('a.js'), 'glob rejects the wrong extension');
    ok((0, tools_1.globToRegExp)('src/*.json').test('src/package.json'), 'glob with a fixed folder');
    // %TEMP% is not always writable (locked-down profiles), so stage inside the app folder
    const stage = node_path_1.default.join(electron_1.app.getPath('userData'), 'selftest');
    node_fs_1.default.mkdirSync(stage, { recursive: true });
    const sandbox = node_fs_1.default.mkdtempSync(node_path_1.default.join(stage, 'ws-'));
    const ctx = { workspace: sandbox, scope: 'workspace', maxOutput: 20000, shellTimeoutMs: 20000 };
    try {
        (0, tools_1.resolveInWorkspace)(ctx, '../escape.txt');
        ok(false, 'path escape is rejected');
    }
    catch (e) {
        ok(e instanceof tools_1.PathError, 'path escape is rejected', e.message.slice(0, 40));
    }
    ok((0, tools_1.resolveInWorkspace)(ctx, 'sub/a.txt').startsWith(sandbox), 'inside paths resolve');
    void (async () => {
        try {
            say('');
            say('--- tools in action ---');
            const w = await (0, tools_1.executeTool)(ctx, call('write_file', { path: 'sub/hello.txt', content: 'line one\nline two\n' }));
            ok(w.ok, 'write_file creates folders and the file', w.summary);
            ok(node_fs_1.default.existsSync(node_path_1.default.join(sandbox, 'sub', 'hello.txt')), 'the file is really on disk');
            const r = await (0, tools_1.executeTool)(ctx, call('read_file', { path: 'sub/hello.txt' }));
            ok(r.ok && r.text.includes('line two'), 'read_file returns the content');
            ok(/\b1\| line one/.test(r.text), 'read_file numbers the lines');
            const e1 = await (0, tools_1.executeTool)(ctx, call('replace_in_file', { path: 'sub/hello.txt', find: 'line two', replace: 'line 2' }));
            ok(e1.ok, 'replace_in_file edits', e1.summary);
            ok(node_fs_1.default.readFileSync(node_path_1.default.join(sandbox, 'sub', 'hello.txt'), 'utf8').includes('line 2'), 'the edit is on disk');
            const e2 = await (0, tools_1.executeTool)(ctx, call('replace_in_file', { path: 'sub/hello.txt', find: 'nope', replace: 'x' }));
            ok(!e2.ok, 'replace_in_file fails when the snippet is missing');
            const l = await (0, tools_1.executeTool)(ctx, call('list_dir', { path: '.', depth: 2 }));
            ok(l.ok && l.text.includes('hello.txt'), 'list_dir walks the tree');
            const f = await (0, tools_1.executeTool)(ctx, call('find_files', { pattern: '**/*.txt' }));
            ok(f.ok && f.text.includes('sub/hello.txt'), 'find_files matches by glob');
            const s = await (0, tools_1.executeTool)(ctx, call('search_text', { query: 'line 2' }));
            ok(s.ok && s.text.includes('hello.txt'), 'search_text finds a line');
            const esc = await (0, tools_1.executeTool)(ctx, call('read_file', { path: '../../../windows/win.ini' }));
            ok(!esc.ok && /outside the workspace/i.test(esc.summary), 'the jail holds for reads too', esc.summary);
            const mk = await (0, tools_1.executeTool)(ctx, call('make_dir', { path: 'deep/nested/dir' }));
            ok(mk.ok && node_fs_1.default.existsSync(node_path_1.default.join(sandbox, 'deep', 'nested', 'dir')), 'make_dir creates parents');
            const mv = await (0, tools_1.executeTool)(ctx, call('move_path', { from: 'sub/hello.txt', to: 'deep/hello.txt' }));
            ok(mv.ok && node_fs_1.default.existsSync(node_path_1.default.join(sandbox, 'deep', 'hello.txt')), 'move_path moves');
            const del = await (0, tools_1.executeTool)(ctx, call('delete_path', { path: 'deep/nested' }));
            ok(del.ok && !node_fs_1.default.existsSync(node_path_1.default.join(sandbox, 'deep', 'nested')), 'delete_path removes a folder');
            const rootDel = await (0, tools_1.executeTool)(ctx, call('delete_path', { path: '.' }));
            ok(!rootDel.ok, 'delete_path refuses the workspace root');
            const sh = await Promise.race([
                (0, tools_1.executeTool)(ctx, call('run_command', { command: 'echo hello-from-shell', timeoutMs: 12000 })),
                new Promise((r) => setTimeout(() => r({ ok: false, summary: 'the shell never answered (blocked by the host?)', text: '' }), 20000)),
            ]);
            ok(sh.ok && /hello-from-shell/.test(sh.text), 'run_command captures stdout', sh.ok ? sh.summary : `${sh.summary} :: ${sh.text.slice(0, 100)}`);
            const bad = await (0, tools_1.executeTool)(ctx, call('run_command', { command: 'this-command-does-not-exist-xyz' }));
            ok(!bad.ok, 'a failing command reports a failure');
            const tree = (0, tools_1.workspaceTree)(sandbox, 3);
            ok(tree.length > 0, 'workspaceTree returns nodes', `${tree.length} top-level entries`);
            // ---------------------------------------------------------- the two permissions
            say('');
            say('--- permission scope ---');
            {
                const machineCtx = { ...ctx, scope: 'machine' };
                // A path deliberately outside the workspace but inside the project, so the test stays
                // reproducible: this host blocks writes to both %TEMP% and the home folder, which
                // would otherwise look like a scope failure instead of a host restriction.
                const outside = node_path_1.default.join(node_path_1.default.dirname(sandbox), 'outside.txt');
                // workspace scope refuses an absolute path outside the jail
                const denied = await (0, tools_1.executeTool)(ctx, call('write_file', { path: outside, content: 'nope' }));
                ok(!denied.ok && /outside the workspace/i.test(denied.summary), 'workspace scope refuses an outside path');
                ok(!node_fs_1.default.existsSync(outside), 'and nothing was written');
                // machine scope reaches the whole computer
                const allowed = await (0, tools_1.executeTool)(machineCtx, call('write_file', { path: outside, content: 'yes' }));
                ok(allowed.ok, 'machine scope writes anywhere', allowed.summary);
                ok(node_fs_1.default.existsSync(outside) && node_fs_1.default.readFileSync(outside, 'utf8') === 'yes', 'the outside file really exists');
                const readBack = await (0, tools_1.executeTool)(machineCtx, call('read_file', { path: outside }));
                ok(readBack.ok && readBack.text.includes('yes'), 'machine scope reads it back');
                const readDenied = await (0, tools_1.executeTool)(ctx, call('read_file', { path: outside }));
                ok(!readDenied.ok, 'workspace scope still refuses to read it');
                // a drive root is never deletable, whatever the scope
                const rootDel = await (0, tools_1.executeTool)(machineCtx, call('delete_path', { path: node_path_1.default.parse(outside).root }));
                ok(!rootDel.ok && /whole drive/i.test(rootDel.summary), 'machine scope refuses to delete a drive root', rootDel.summary);
                // ~ expands to the home folder
                const home = await (0, tools_1.executeTool)(machineCtx, call('list_dir', { path: '~', depth: 1, limit: 5 }));
                ok(home.ok, 'machine scope expands ~ to the home folder', home.summary);
                // the tool descriptions follow the scope
                const wsDesc = String((0, tools_1.toolSpecs)('workspace').find((s) => s.name === 'read_file').parameters
                    .properties.path.description);
                const mDesc = String((0, tools_1.toolSpecs)('machine').find((s) => s.name === 'read_file').parameters
                    .properties.path.description);
                ok(/relative to the workspace/.test(wsDesc), 'workspace tool text mentions the workspace', wsDesc);
                ok(/absolute path on this computer/.test(mDesc), 'machine tool text mentions the whole computer', mDesc);
                // the system prompt states the permission in force
                ok(/workspace only/i.test((0, agent_1.systemPrompt)('', sandbox, true, 5, 'en', 'workspace')), 'the prompt states workspace-only access');
                ok(/whole-computer access/i.test((0, agent_1.systemPrompt)('', sandbox, true, 5, 'en', 'machine')), 'the prompt states whole-computer access');
                node_fs_1.default.rmSync(outside, { force: true });
            }
            // ---------------------------------------------------------- store
            say('');
            say('--- conversations ---');
            ok((0, store_1.titleFrom)('  ## Fix the build\nmore') === 'Fix the build', 'titles come from the first line');
            const id = `selftest-${Date.now()}`;
            const thread = {
                id, title: 'selftest thread', created: Date.now(), updated: Date.now(),
                workspace: sandbox,
                wire: [{ role: 'user', content: 'hi' }],
                items: [{ kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'hello', chars: 5 }],
            };
            (0, store_1.saveThread)(thread);
            const back = (0, store_1.getThread)(id);
            ok(!!back && back.items.length === 2, 'a conversation round-trips');
            ok((0, store_1.listThreads)().some((x) => x.id === id), 'it shows up in the list');
            (0, store_1.deleteThread)(id);
            ok(!(0, store_1.getThread)(id), 'and it can be deleted');
            // ---------------------------------------------------------- prompts
            say('');
            say('--- agent prompt ---');
            const on = (0, agent_1.systemPrompt)('be nice', sandbox, true, 7, 'zh-CN');
            ok(on.includes(sandbox), 'the prompt carries the workspace root');
            ok(on.includes('be nice'), 'the user prompt is kept');
            ok(/tool rounds/i.test(on), 'the prompt explains the tool budget');
            ok(on.includes('简化中文') || on.includes('简体中文'), 'the Chinese language rule is injected');
            ok(/language the user writes in/i.test(on), 'the model is told to mirror the user language');
            ok((0, agent_1.systemPrompt)('be nice', sandbox, false, 7, 'zh-CN').startsWith('be nice'), 'agent off keeps the profile prompt');
            ok((0, agent_1.systemPrompt)('', sandbox, false, 7, 'en').length > 0, 'agent off still yields a usable prompt');
            say('');
            say('--- the two hotkeys ---');
            {
                const base = (0, config_1.defaultConfig)();
                ok(base.hotkey === 'Ctrl+Alt+G', 'mode 1: the main window hotkey', base.hotkey);
                ok(base.quick.hotkey === 'Ctrl+Alt+Space', 'mode 2: the command bar hotkey', base.quick.hotkey);
                ok(base.quick.hotkey !== base.hotkey, 'the two modes use different shortcuts');
                ok(base.quick.enabled, 'the command bar is enabled by default');
                ok(base.quick.thickness >= 2 && base.quick.thickness <= 24, 'bar border width is sane', `${base.quick.thickness}px`);
                ok(base.quick.hideAfterMs >= 0, 'the bar has an auto-hide delay', `${base.quick.hideAfterMs}ms`);
                const round2 = (0, config_1.loadConfig)();
                ok(typeof round2.quick.hotkey === 'string' && round2.quick.hotkey.length > 0, 'the bar hotkey loads');
                ok(typeof round2.quick.enabled === 'boolean', 'the bar toggle loads');
            }
            say('');
            say('--- the agent orb ---');
            {
                const base = (0, config_1.defaultConfig)();
                ok(base.orb.enabled, 'the orb is on by default');
                ok(/^[0-9A-F]{6}$/.test(base.orb.primary), 'primary colour is a hex triplet', base.orb.primary);
                ok(/^[0-9A-F]{6}$/.test(base.orb.secondary), 'highlight colour is a hex triplet', base.orb.secondary);
                ok(base.orb.size >= 16 && base.orb.size <= 64, 'window orb size is sane', `${base.orb.size}px`);
                ok(base.orb.barSize >= 40 && base.orb.barSize <= 180, 'bar orb size is sane', `${base.orb.barSize}px`);
                const round3 = (0, config_1.loadConfig)();
                ok(typeof round3.orb.enabled === 'boolean' && round3.orb.primary.length === 6, 'orb settings load');
            }
            say('');
            say('--- language resolution ---');
            ok((0, language_1.resolveUiLang)('zh-CN') === 'zh-CN', 'an explicit zh-CN wins');
            ok((0, language_1.resolveUiLang)('en') === 'en', 'an explicit en wins');
            ok((0, language_1.resolveUiLang)('auto') === (0, language_1.resolveUiLang)('auto'), 'auto resolves deterministically');
            ok(/language/i.test((0, language_1.languageRules)('en')), 'english rules mention language');
            ok(/简体中文/.test((0, language_1.languageRules)('zh-CN')), 'chinese rules name Simplified Chinese');
            // ---------------------------------------------------------- config
            say('');
            say('--- configuration ---');
            {
                const file = (0, config_1.getConfigPath)();
                ok(!!file && file.endsWith('config.ini'), 'config path resolved', file);
                const cfg = (0, config_1.loadConfig)();
                // the main process fills this in at boot when the config has never been written
                if (!cfg.workspace) {
                    cfg.workspace = node_os_1.default.homedir();
                    (0, config_1.saveConfig)(cfg);
                }
                ok(cfg.providers.length >= 6, 'six provider profiles', String(cfg.providers.length));
                ok(cfg.agent.enabled && !cfg.agent.autoApprove, 'agent on, asking before risky tools');
                ok(cfg.agent.maxSteps >= 1 && cfg.agent.maxSteps <= 60, 'tool budget is sane', String(cfg.agent.maxSteps));
                ok(!!cfg.workspace, 'a workspace is set', cfg.workspace);
                const before = JSON.stringify(cfg);
                cfg.agent.autoApprove = true;
                cfg.agent.maxSteps = 9;
                cfg.language = 'en';
                (0, config_1.saveConfig)(cfg);
                const round = (0, config_1.loadConfig)();
                ok(round.agent.autoApprove && round.agent.maxSteps === 9 && round.language === 'en', 'agent settings survive the round trip');
                (0, config_1.saveConfig)(JSON.parse(before));
                ok((0, config_1.loadConfig)().agent.maxSteps === JSON.parse(before).agent.maxSteps, 'original config restored');
            }
            say('');
            say('--- runtime ---');
            ok((0, providers_1.activeProvider)((0, config_1.defaultConfig)()).id === 'deepseek', 'active provider resolves');
            ok(electron_1.app.getVersion() === '2.0.0', 'app version', electron_1.app.getVersion());
            ok(process.versions.electron.startsWith('33.'), 'electron runtime', process.versions.electron);
            say('');
            say(`=== ${failures ? 'FAILURES' : 'ALL PASSED'} (${failures} failure${failures === 1 ? '' : 's'}) ===`);
            say('');
        }
        catch (e) {
            failures++;
            say(`[FAIL] the suite threw: ${e?.stack ?? e?.message ?? e}`);
        }
        try {
            node_fs_1.default.rmSync(stage, { recursive: true, force: true });
        }
        catch {
            /* the staging folder can stay */
        }
        electron_1.app.exit(failures ? 1 : 0);
    })();
}
