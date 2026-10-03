import { readableMessage } from './analyzer.mjs';

function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(36);
}

function sampleSimilarity(a, b) {
    if (!a.length && !b.length) return 1;
    const lengthScore = Math.min(a.length, b.length) / Math.max(a.length, b.length, 1);
    const sample = text => `${text.slice(0, 96)}|${text.slice(-96)}`;
    const left = sample(a), right = sample(b);
    let same = 0;
    const width = Math.min(left.length, right.length);
    for (let i = 0; i < width; i++) if (left[i] === right[i]) same++;
    return lengthScore * .35 + same / Math.max(left.length, right.length, 1) * .65;
}

export function compare(before, after) {
    const old = before.messages.map((message, index) => ({
        index, role: String(message?.role || 'unknown'), raw: JSON.stringify(message), text: readableMessage(message),
    }));
    const now = after.messages.map((message, index) => ({
        index, role: String(message?.role || 'unknown'), raw: JSON.stringify(message), text: readableMessage(message),
    }));
    const matchedOld = new Set(), matchedNew = new Set(), rows = [];
    const exact = new Map();
    old.forEach(item => {
        const key = `${item.role}:${item.raw.length}:${hash(item.raw)}`;
        if (!exact.has(key)) exact.set(key, { items: [], next: 0 });
        exact.get(key).items.push(item);
    });
    now.forEach(item => {
        const key = `${item.role}:${item.raw.length}:${hash(item.raw)}`;
        const queue = exact.get(key);
        const previous = queue ? queue.items[queue.next++] : null;
        if (previous && previous.raw === item.raw) {
            matchedOld.add(previous.index); matchedNew.add(item.index);
            rows.push({ status: 'unchanged', beforeIndex: previous.index, afterIndex: item.index });
        }
    });
    // Exact matches anchor the sequence. For leftovers, consider only nearby
    // same-role messages; similarity samples stay bounded for long contexts.
    now.filter(item => !matchedNew.has(item.index)).forEach(item => {
        let best = null, bestScore = 0;
        for (let index = Math.max(0, item.index - 5); index <= Math.min(old.length - 1, item.index + 5); index++) {
            const previous = old[index];
            if (matchedOld.has(index) || previous.role !== item.role) continue;
            const score = sampleSimilarity(previous.text, item.text) - Math.abs(previous.index - item.index) * .025;
            if (score > bestScore) { best = previous; bestScore = score; }
        }
        if (best && bestScore >= .3) {
            matchedOld.add(best.index); matchedNew.add(item.index);
            rows.push({ status: 'modified', beforeIndex: best.index, afterIndex: item.index });
        }
    });
    old.filter(item => !matchedOld.has(item.index)).forEach(item => rows.push({ status: 'removed', beforeIndex: item.index, afterIndex: null }));
    now.filter(item => !matchedNew.has(item.index)).forEach(item => rows.push({ status: 'added', beforeIndex: null, afterIndex: item.index }));
    rows.sort((a, b) => (a.afterIndex ?? a.beforeIndex) - (b.afterIndex ?? b.beforeIndex));
    return rows.map(row => ({ ...row,
        role: now[row.afterIndex]?.role || old[row.beforeIndex]?.role,
        beforeTokens: row.beforeIndex === null ? 0 : before.messageTokens[row.beforeIndex],
        afterTokens: row.afterIndex === null ? 0 : after.messageTokens[row.afterIndex],
    }));
}
