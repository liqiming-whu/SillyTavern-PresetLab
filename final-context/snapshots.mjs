const KEY = 'preset-editor.final-context.snapshots.v1';
const MAX = 10;

export function loadSnapshots(storage = localStorage) {
    try {
        const value = JSON.parse(storage.getItem(KEY) || '[]');
        return Array.isArray(value) ? value.filter(s => Array.isArray(s.messages) && Array.isArray(s.messageTokens)).slice(0, MAX) : [];
    } catch { return []; }
}

export function saveSnapshot(capture, storage = localStorage) {
    if (!capture || capture.totalTokens === null) throw new Error('Token counting is still in progress');
    const snapshot = JSON.parse(JSON.stringify(capture));
    const snapshots = [snapshot, ...loadSnapshots(storage)].slice(0, MAX);
    // Large prompts can exceed the browser quota. Retain as many as fit.
    while (snapshots.length) {
        try { storage.setItem(KEY, JSON.stringify(snapshots)); return snapshots; }
        catch { snapshots.pop(); }
    }
    throw new Error('Browser storage has no room for this snapshot');
}
