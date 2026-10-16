"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemPrompt = systemPrompt;
exports.runAgent = runAgent;
// src/main/agent.ts - the tool loop: model -> tools -> model until the job is done
const providers_1 = require("./providers");
const tools_1 = require("./tools");
const language_1 = require("./language");
/** a ceiling that only exists so a runaway model cannot loop forever */
const HARD_STEP_CAP = 400;
const STEP_SEPARATOR = '\n\n';
function systemPrompt(base, workspace, agentOn, steps, lang = 'auto', scope = 'workspace', deep = false) {
    const trimmed = (base || '').trim();
    const rules = (0, language_1.languageRules)(lang);
    // the whale-girl persona is Chinese by definition, so the interface language must not
    // override it - the persona rule wins and the language rule is only a fallback
    const persona = trimmed.includes('CETACEA_LOLI');
    const langRules = persona
        ? '语言：只用简体中文回答（代码、命令、路径、报错原文可以保持原样）。'
        : rules;
    if (!agentOn) {
        return [trimmed || 'You are a concise, helpful assistant.', langRules].join('\n\n');
    }
    const parts = [];
    if (trimmed)
        parts.push(trimmed);
    parts.push([
        'You are DomeOS Team AI Agent, an autonomous coding and operations agent running on the user\'s Windows machine.',
        `Your workspace root is: ${workspace}`,
        'You have tools to read, write, move and delete files, search a codebase, run shell commands,',
        'search the internet and read web pages.',
        scope === 'machine'
            ? 'PERMISSION: whole-computer access. Any absolute path on any drive is allowed, not just the ' +
                'workspace: Windows system folders, other user profiles, other drives, the registry through ' +
                'run_command - all reachable. Be careful, a wrong delete_path or run_command here is permanent.'
            : 'PERMISSION: workspace only. Every path must stay inside the workspace root; the tools refuse ' +
                'anything outside it, so do not try to reach other folders.',
        '',
        'Rules:',
        ...(deep ? [
            '0. Think it through first: work out the plan, the files involved and the failure modes',
            '   before you touch anything. State the conclusion, not the deliberation.',
        ] : []),
        '1. Inspect before you change: list the folder or read the file first, then edit.',
        '2. Prefer replace_in_file over write_file when only part of a file changes.',
        scope === 'machine'
            ? '3. Use absolute paths (C:\\Users\\..., D:\\...) for anything outside the workspace.'
            : '3. Every path you pass to a tool is relative to the workspace root.',
        '4. Run the tests or the build after changing code, and fix what breaks.',
        '5. A short tool summary is enough; never paste a whole file back to the user.',
        '6. Never invent file contents or command output - use the tools.',
        `7. You may use at most ${steps} tool rounds for this turn, so be efficient.`,
        '8. When the task is finished, answer with a short summary and stop calling tools.',
        '9. You are online: for anything current - news, prices, versions, documentation, a',
        '   library you have not seen - call web_search first, then fetch_url on the best result.',
        '   Never answer such a question from memory and never say you cannot browse.',
        '10. You run on a real Windows machine with the user\'s rights: launching an application,',
        '    opening a file or driving the shell is within your reach - use run_command for it.',
        '    Do not claim something is impossible before you have tried the obvious command.',
    ].join('\n'));
    parts.push(langRules);
    return parts.join('\n\n');
}
/** Strips a leading "think" block so the transcript stays readable. */
function splitThinking(text) {
    const m = /^<(think|thinking)>([\s\S]*?)<\/\1>/i.exec(text.trimStart());
    if (!m)
        return { thinking: '', answer: text };
    return { thinking: m[2].trim(), answer: text.slice(m[0].length).trimStart() };
}
async function runAgent(deps, history) {
    const specs = deps.agent.enabled ? (0, tools_1.toolSpecs)(deps.agent.scope, deps.agent.webSearch, !!deps.aiController) : [];
    const ctx = {
        workspace: deps.workspace,
        scope: deps.agent.scope,
        maxOutput: deps.agent.maxOutput,
        shellTimeoutMs: deps.agent.shellTimeoutMs,
        aiController: deps.aiController,
    };
    const wire = history.slice();
    let finalText = '';
    let step = 0;
    let lastHint;
    // maxSteps 0 means no limit. The loop still ends on its own when the model stops calling
    // tools; HARD_STEP_CAP only stops a model that would never settle.
    const stepLimit = deps.agent.maxSteps > 0 ? deps.agent.maxSteps : HARD_STEP_CAP;
    for (; step < stepLimit; step++) {
        if (deps.signal.aborted)
            return { text: finalText, ok: true, steps: step, wire };
        const result = await (0, providers_1.streamChat)(deps.provider, wire, specs, {
            onDelta: (t) => deps.emit({ id: deps.id, kind: 'delta', text: t }),
            onStatus: (t) => deps.emit({ id: deps.id, kind: 'status', text: t }),
        }, deps.signal);
        if (!result.ok) {
            return { text: finalText, ok: false, hint: result.hint, steps: step + 1, wire };
        }
        const { thinking, answer } = splitThinking(result.text);
        if (thinking)
            deps.emit({ id: deps.id, kind: 'thinking', text: thinking });
        if (answer)
            finalText = finalText ? finalText + STEP_SEPARATOR + answer : answer;
        const calls = result.toolCalls.filter((c) => c.name);
        if (!calls.length) {
            wire.push({ role: 'assistant', content: result.text });
            return { text: finalText || result.text, ok: true, steps: step + 1, wire };
        }
        wire.push({
            role: 'assistant',
            content: result.text,
            tool_calls: calls,
        });
        for (const call of calls) {
            if (deps.signal.aborted)
                return { text: finalText, ok: true, steps: step + 1, wire };
            const spec = specs.find((s) => s.name === call.name);
            const invocation = {
                id: call.id,
                name: call.name,
                args: call.args ?? {},
                title: spec?.title ?? call.name,
                dangerous: spec?.dangerous ?? true,
            };
            const needsAsk = deps.agent.enabled && invocation.dangerous && !deps.agent.autoApprove;
            if (needsAsk) {
                deps.emit({ id: deps.id, kind: 'approval', call: invocation });
                const allowed = await deps.askApproval(invocation);
                if (!allowed) {
                    const declined = `The user declined to run "${call.name}". Ask before trying again, or continue without it.`;
                    deps.emit({
                        id: deps.id,
                        kind: 'toolResult',
                        result: { id: 0, name: call.name, title: invocation.title, summary: 'declined by the user', ok: false, ms: 0 },
                    });
                    wire.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: declined });
                    continue;
                }
            }
            deps.emit({ id: deps.id, kind: 'tool', call: invocation });
            const started = Date.now();
            const outcome = await (0, tools_1.executeTool)(ctx, invocation);
            const ms = Date.now() - started;
            deps.emit({
                id: deps.id,
                kind: 'toolResult',
                result: { id: 0, name: call.name, title: invocation.title, summary: outcome.summary, ok: outcome.ok, ms },
            });
            wire.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: outcome.text });
            if (!outcome.ok && /outside the workspace/i.test(outcome.summary)) {
                lastHint = 'err.workspace';
            }
        }
    }
    deps.emit({
        id: deps.id,
        kind: 'thinking',
        text: `reached the tool limit (${deps.agent.maxSteps} rounds)`,
    });
    return { text: finalText, ok: true, hint: lastHint, steps: step, wire };
}
