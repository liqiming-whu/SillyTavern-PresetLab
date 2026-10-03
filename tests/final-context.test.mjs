import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapture } from '../final-context/capture.mjs';
import { createCounter } from '../final-context/tokenizer.mjs';
import { compare } from '../final-context/diff.mjs';
import { loadSnapshots, saveSnapshot } from '../final-context/snapshots.mjs';
import { readableMessage } from '../final-context/analyzer.mjs';
import { toMarkdown } from '../final-context/export.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function emitter() {
    let listener;
    return {
        on: (_, handler) => { listener = handler; },
        removeListener: () => { listener = null; },
        emit: data => listener?.(data),
    };
}

test('captures standard request after build without mutating it or waiting for counting', async () => {
    const events = emitter();
    const message = { role: 'user', content: [{ type: 'text', text: 'World Info' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }], api_key: 'hidden' };
    let finishCount;
    const counter = new Promise(resolve => { finishCount = resolve; });
    const capture = createCapture({ eventSource: events, eventType: 'ready', count: () => counter, onUpdate: () => {} });
    const request = { model: 'test-model', chat_completion_source: 'openai', proxy_password: 'never-copy', stream: true, messages: [message] };
    assert.equal(events.emit(request), undefined);
    assert.equal(capture.getCurrent().totalTokens, null);
    assert.equal(JSON.stringify(capture.getCurrent()).includes('never-copy'), false);
    message.content[0].text = 'changed later';
    finishCount({ tokens: 42, mode: 'tokenized' });
    await tick();
    assert.equal(capture.getCurrent().messages[0].content[0].text, 'World Info');
    assert.equal(capture.getCurrent().messages[0].api_key, '[redacted]');
    assert.equal(capture.getCurrent().totalTokens, 42);
    assert.deepEqual(capture.getCurrent().roleSummary, [{ role: 'user', tokens: 42 }]);
    capture.stop();
});

test('parser and tokenizer failure never escape the event listener', async () => {
    const events = emitter();
    const capture = createCapture({ eventSource: events, eventType: 'ready', count: async () => { throw Error('offline'); }, onUpdate: () => {} });
    const circular = {}; circular.self = circular;
    assert.doesNotThrow(() => events.emit({ messages: [circular] }));
    assert.equal(capture.getCurrent(), null);
    assert.doesNotThrow(() => events.emit({ messages: [{ role: 'user', content: 'safe' }] }));
    await tick();
    assert.ok(capture.getCurrent().totalTokens > 0);
    assert.equal(capture.getCurrent().tokenMode, 'estimated');
    capture.stop();
});

test('model-aware tokenizer and explicit estimated fallback', async () => {
    let url, body;
    const message = { role: 'user', content: 'result' };
    const count = createCounter({ fetchImpl: async (target, options) => {
        url = target; body = options.body;
        return { ok: true, json: async () => ({ token_count: 19 }) };
    }, headers: () => ({ 'Content-Type': 'application/json' }), getTokenCountAsync: async () => 8 });
    assert.deepEqual(await count(message, 'vendor/model'), { tokens: 19, mode: 'tokenized' });
    assert.equal(url, '/api/tokenizers/openai/count?model=vendor%2Fmodel');
    assert.equal(body, JSON.stringify([message]));
    const complex = createCounter({ fetchImpl: async () => assert.fail('complex messages must not use model endpoint'), headers: () => ({}), getTokenCountAsync: async () => 8 });
    assert.deepEqual(await complex({ role: 'tool', content: [{ type: 'text', text: 'result' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] }, 'model'), { tokens: 8, mode: 'estimated' });
    const fallback = createCounter({ fetchImpl: async () => { throw Error('offline'); }, headers: () => ({}), getTokenCountAsync: async () => { throw Error('unavailable'); } });
    assert.equal((await fallback(message, 'model')).mode, 'estimated');
});

test('diff uses exact matches across index shifts and marks edits, additions, removals', () => {
    const before = { messages: [
        { role: 'system', content: 'persistent' },
        { role: 'system', content: 'long preset prompt abcdefghijklmnopqrstuvwxyz' },
        { role: 'user', content: 'old question' },
    ], messageTokens: [4, 40, 5] };
    const after = { messages: [
        { role: 'system', content: 'persistent' },
        { role: 'system', content: 'long preset prompt abcdefghijklmnop EDIT' },
        { role: 'assistant', content: 'new reply' },
    ], messageTokens: [4, 25, 6] };
    assert.deepEqual(compare(before, after).map(row => row.status).sort(), ['added', 'modified', 'removed', 'unchanged']);
    assert.equal(compare(before, after).find(row => row.status === 'modified').afterTokens - compare(before, after).find(row => row.status === 'modified').beforeTokens, -15);
    const disabled = { messages: [before.messages[0], before.messages[2]], messageTokens: [4, 5] };
    assert.equal(compare(before, disabled).find(row => row.beforeIndex === 1).status, 'removed');
    const metadataBefore = { messages: [{ role: 'assistant', content: 'same', tool_call_id: 'a' }], messageTokens: [4] };
    const metadataAfter = { messages: [{ role: 'assistant', content: 'same', tool_call_id: 'b' }], messageTokens: [4] };
    assert.equal(compare(metadataBefore, metadataAfter)[0].status, 'modified');
});

test('snapshot is local, bounded and markdown retains multimodal structure', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const capture = { timestamp: '2026-09-28T00:00:00Z', model: 'model', provider: 'openai',
        messages: [{ role: 'developer', content: [{ type: 'text', text: 'hello' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(300) } }] }],
        messageTokens: [12], messageModes: ['tokenized'], messageChars: [330], totalTokens: 12,
        roleSummary: [{ role: 'developer', tokens: 12 }], tokenMode: 'tokenized' };
    saveSnapshot(capture, storage);
    assert.equal(loadSnapshots(storage).length, 1);
    assert.equal(loadSnapshots(storage)[0].messages[0].content[0].text, 'hello');
    assert.match(readableMessage(capture.messages[0]), /embedded media/);
    assert.match(toMarkdown(capture), /\| developer \| 12 \| 100\.0% \|/);
    assert.match(toMarkdown(capture), /## Message 1/);
});

test('large history comparison remains bounded and snapshot quota prunes old copies', () => {
    const long = '一段很长的上下文'.repeat(20000);
    const messages = Array.from({ length: 700 }, (_, index) => ({ role: index % 2 ? 'user' : 'assistant', content: `history ${index} ` + 'fiction '.repeat(120) }));
    messages.splice(350, 0, { role: 'system', content: long });
    assert.ok(messages.reduce((size, message) => size + message.content.length, 0) > 800000);
    const before = { messages, messageTokens: messages.map(() => 10) };
    const afterMessages = messages.filter((_, index) => index !== 350);
    const after = { messages: afterMessages, messageTokens: afterMessages.map(() => 10) };
    assert.equal(compare(before, after).filter(row => row.status === 'removed').length, 1);
    let saved = '';
    const storage = { getItem: () => saved, setItem: (_, value) => { if (value.length > 150) throw Error('quota'); saved = value; } };
    const small = { timestamp: 'now', messages: [{ role: 'user', content: 'small' }], messageTokens: [1], totalTokens: 1 };
    saveSnapshot(small, storage);
    saveSnapshot(small, storage);
    assert.equal(loadSnapshots(storage).length, 1);
});
