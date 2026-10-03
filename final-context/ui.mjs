import { createCapture } from './capture.mjs';
import { createCounter } from './tokenizer.mjs';
import { readableMessage } from './analyzer.mjs';
import { compare } from './diff.mjs';
import { loadSnapshots, saveSnapshot } from './snapshots.mjs';
import { toMarkdown } from './export.mjs';

const number = value => Number(value || 0).toLocaleString('en-US');
const percent = (part, total) => total ? `${(part / total * 100).toFixed(1)}%` : '0.0%';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createFinalContext({ eventSource, eventType, headers, getTokenCountAsync, notify = () => {} }) {
    let pane = null, view = 'messages', snapshots = loadSnapshots(), selected = 0;
    let diffCache = null, diffKey = null;
    const count = createCounter({ fetchImpl: (...args) => fetch(...args), headers, getTokenCountAsync });
    const capture = createCapture({ eventSource, eventType, count, onUpdate: () => {
        diffCache = null; diffKey = null;
        if (pane?.isConnected && !pane.classList.contains('pe-hidden')) render();
    } });

    function current() { return capture.getCurrent(); }
    function snapshot() { return snapshots[selected] || null; }
    function render() {
        if (!pane) return;
        const data = current();
        if (!data) {
            pane.innerHTML = '<div class="pe-fc-empty">尚未捕获最终上下文。发送/生成一次消息后即可分析。</div>';
            return;
        }
        const ready = data.totalTokens !== null;
        const previous = snapshot();
        const delta = ready && previous ? data.totalTokens - previous.totalTokens : null;
        const change = previous?.totalTokens ? `${delta >= 0 ? '+' : ''}${(delta / previous.totalTokens * 100).toFixed(1)}%` : 'Unknown';
        pane.innerHTML = `
            <section class="pe-fc-summary">
              <h2>Final Context</h2>
              <div class="pe-fc-meta">Model: ${escape(data.model || 'Unknown')} · Provider: ${escape(data.provider || 'Unknown')} · Captured: ${escape(data.timestamp)}</div>
              <div class="pe-fc-stats"><span>Messages <b>${number(data.messages.length)}</b></span><span>Total Tokens <b>${ready ? number(data.totalTokens) : '计算中…'}</b> ${escape(data.tokenMode)}</span><span>Context Limit <b>Unknown</b></span><span>Usage <b>Unknown</b></span></div>
              ${previous && ready ? `<div class="pe-fc-delta">Current: ${number(data.totalTokens)} · Previous Snapshot: ${number(previous.totalTokens)} · Δ ${delta >= 0 ? '+' : ''}${number(delta)} (${change})</div>` : ''}
              <div class="pe-fc-roles">${ready ? data.roleSummary.map(item => `<div><b>${escape(item.role)}</b><span>${number(item.tokens)}</span><span>${percent(item.tokens, data.totalTokens)}</span></div>`).join('') : ''}</div>
            </section>
            <div class="pe-fc-actions">
              <button class="pe-btn" data-action="snapshot" ${ready ? '' : 'disabled'}>Save Snapshot</button>
              <select aria-label="Previous Snapshot" data-action="select-snapshot"><option value="-1">选择 Snapshot</option>${snapshots.map((item, index) => `<option value="${index}" ${index === selected ? 'selected' : ''}>${escape(item.timestamp)} · ${number(item.totalTokens)} tokens</option>`).join('')}</select>
              <button class="pe-btn" data-action="markdown" ${ready ? '' : 'disabled'}>Export Markdown</button>
            </div>
            <div class="pe-fc-views">${['messages', 'ranking', 'raw', 'diff'].map(name => `<button class="pe-btn ${view === name ? 'pe-btn-primary' : ''}" data-view="${name}">${({ messages: 'Messages', ranking: 'Token Ranking', raw: 'Raw', diff: 'Diff' })[name]}</button>`).join('')}</div>
            <div class="pe-fc-content"></div>`;
        const content = pane.querySelector('.pe-fc-content');
        if (view === 'messages') renderMessages(content, data);
        if (view === 'ranking') renderRanking(content, data);
        if (view === 'raw') renderRaw(content, data);
        if (view === 'diff') renderDiff(content, data, previous);
    }

    function renderMessages(host, data) {
        const fragment = document.createDocumentFragment();
        data.messages.forEach((message, index) => {
            const item = document.createElement('div');
            item.className = 'pe-fc-message';
            const chars = data.messageChars[index];
            item.innerHTML = `<button class="pe-fc-row" data-action="expand" data-index="${index}" aria-expanded="false"><b>#${index + 1} ${escape(String(message?.role || 'unknown').toUpperCase())}</b><span>${data.messageTokens[index] === undefined ? '…' : number(data.messageTokens[index])} tokens · ${chars === undefined ? '…' : number(chars)} chars</span></button><button class="pe-btn" data-action="copy-message" data-index="${index}" title="复制单条 message JSON">复制</button>`;
            fragment.appendChild(item);
        });
        host.innerHTML = '<div class="pe-fc-tools"><button class="pe-btn" data-action="expand-all">全部展开</button><button class="pe-btn" data-action="collapse-all">全部折叠</button></div>';
        host.appendChild(fragment);
    }

    function renderRanking(host, data) {
        if (data.totalTokens === null) { host.textContent = 'Token 计算中…'; return; }
        const sorted = data.messageTokens.map((tokens, index) => ({ tokens, index })).sort((a, b) => b.tokens - a.tokens);
        const max = sorted[0]?.tokens || 1;
        host.innerHTML = sorted.map(item => `<div class="pe-fc-rank"><span>#${item.index + 1} ${escape(data.messages[item.index]?.role || 'unknown')}</span><span>${number(item.tokens)} · ${percent(item.tokens, data.totalTokens)}</span><div class="pe-fc-track"><i style="width:${Math.max(0, item.tokens / max * 100)}%"></i></div></div>`).join('');
    }

    function renderRaw(host, data) {
        host.innerHTML = '<div class="pe-fc-tools"><button class="pe-btn" data-action="copy-raw">Copy JSON</button><button class="pe-btn" data-action="download-raw">Download JSON</button></div>';
        const pre = document.createElement('pre');
        pre.className = 'pe-fc-pre';
        pre.textContent = JSON.stringify(data.messages, null, 2);
        host.appendChild(pre);
    }

    function renderDiff(host, data, previous) {
        if (!previous) { host.textContent = '请先保存 Snapshot，再生成一次消息以比较。'; return; }
        if (data.totalTokens === null) { host.textContent = 'Token 计算中…'; return; }
        const key = `${data.timestamp}:${previous.timestamp}`;
        if (key !== diffKey) { diffCache = compare(previous, data); diffKey = key; }
        const delta = data.totalTokens - previous.totalTokens;
        host.innerHTML = `<div class="pe-fc-delta">Before: ${number(previous.totalTokens)} · After: ${number(data.totalTokens)} · Difference: ${delta >= 0 ? '+' : ''}${number(delta)} · Change: ${previous.totalTokens ? (delta / previous.totalTokens * 100).toFixed(1) + '%' : 'Unknown'} · Messages: ${previous.messages.length} → ${data.messages.length}</div>`;
        const fragment = document.createDocumentFragment();
        diffCache.forEach((row, index) => {
            const item = document.createElement('div');
            item.className = `pe-fc-message pe-fc-${row.status}`;
            item.innerHTML = `<button class="pe-fc-row" data-action="expand-diff" data-index="${index}" aria-expanded="false"><b>${escape(row.status.toUpperCase())} · ${escape(row.role)} · ${row.beforeIndex === null ? '—' : '#' + (row.beforeIndex + 1)} → ${row.afterIndex === null ? '—' : '#' + (row.afterIndex + 1)}</b><span>Before ${number(row.beforeTokens)} · After ${number(row.afterTokens)} · Δ ${row.afterTokens - row.beforeTokens >= 0 ? '+' : ''}${number(row.afterTokens - row.beforeTokens)}</span></button>`;
            fragment.appendChild(item);
        });
        host.appendChild(fragment);
    }

    function toggleBody(row, text) {
        const existing = row.parentElement.querySelector('.pe-fc-pre');
        if (existing) { existing.remove(); row.setAttribute('aria-expanded', 'false'); return; }
        const pre = document.createElement('pre');
        pre.className = 'pe-fc-pre'; pre.textContent = text;
        row.parentElement.appendChild(pre);
        row.setAttribute('aria-expanded', 'true');
    }

    async function action(event) {
        const button = event.target.closest('[data-action], [data-view]');
        if (!button || !pane?.contains(button)) return;
        const data = current();
        if (button.dataset.view) { view = button.dataset.view; render(); return; }
        const index = Number(button.dataset.index);
        try {
            switch (button.dataset.action) {
                case 'snapshot': snapshots = saveSnapshot(data); selected = 0; render(); notify('success', 'Snapshot 已保存'); break;
                case 'markdown': download('sillytavern-final-context.md', toMarkdown(data), 'text/markdown;charset=utf-8'); break;
                case 'expand': toggleBody(button, readableMessage(data.messages[index])); break;
                case 'expand-diff': {
                    const row = diffCache[index], before = snapshot();
                    toggleBody(button, `BEFORE\n${row.beforeIndex === null ? '(none)' : readableMessage(before.messages[row.beforeIndex])}\n\nAFTER\n${row.afterIndex === null ? '(none)' : readableMessage(data.messages[row.afterIndex])}`);
                    break;
                }
                case 'expand-all': pane.querySelectorAll('[data-action="expand"][aria-expanded="false"]').forEach(row => toggleBody(row, readableMessage(data.messages[Number(row.dataset.index)]))); break;
                case 'collapse-all': pane.querySelectorAll('[data-action="expand"][aria-expanded="true"]').forEach(row => toggleBody(row, '')); break;
                case 'copy-message': await navigator.clipboard.writeText(JSON.stringify(data.messages[index], null, 2)); notify('success', '已复制 message JSON'); break;
                case 'copy-raw': await navigator.clipboard.writeText(JSON.stringify(data.messages, null, 2)); notify('success', '已复制 JSON'); break;
                case 'download-raw': download('sillytavern-final-context.json', JSON.stringify(data.messages, null, 2), 'application/json;charset=utf-8'); break;
            }
        } catch (error) { notify('error', error.message || '操作失败'); }
    }

    function mount(element) {
        if (pane !== element) {
            pane?.removeEventListener('click', action);
            pane?.removeEventListener('change', change);
            pane = element;
            pane.addEventListener('click', action);
            pane.addEventListener('change', change);
        }
        render();
    }
    function change(event) {
        if (event.target.dataset.action === 'select-snapshot') {
            selected = Number(event.target.value);
            diffKey = null;
            render();
        }
    }
    return { mount, stop: capture.stop, getCurrent: current };
}
