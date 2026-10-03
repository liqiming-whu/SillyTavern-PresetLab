import { estimateTokens, summarize } from './analyzer.mjs';

const sensitiveKey = /^(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|proxy[_-]?password)$/i;

export function createCapture({ eventSource, eventType, count, onUpdate }) {
    let current = null;
    let sequence = 0;
    const listener = data => {
        try {
            if (!Array.isArray(data?.messages)) return;
            // JSON cloning mirrors the body sent by sendOpenAIRequest. Never keep
            // a reference to the mutable request or copy its authentication fields.
            const messages = JSON.parse(JSON.stringify(data.messages, (key, value) => sensitiveKey.test(key) ? '[redacted]' : value));
            const capture = {
                timestamp: new Date().toISOString(),
                model: typeof data.model === 'string' ? data.model : '',
                provider: typeof data.chat_completion_source === 'string' ? data.chat_completion_source : '',
                messages,
                messageChars: [],
                messageTokens: Array(messages.length), messageModes: Array(messages.length), totalTokens: null,
                roleSummary: [], tokenMode: 'pending',
            };
            current = capture;
            const id = ++sequence;
            setTimeout(() => { try { onUpdate(); } catch { /* UI failure is isolated */ } }, 0);
            // Do not return the work promise to eventSource.emit: generation must
            // never wait for tokenizer requests or fail because of this extension.
            setTimeout(async () => {
                try {
                    capture.messageChars = messages.map(message => typeof message?.content === 'string'
                        ? message.content.length : JSON.stringify(message?.content ?? '').length);
                    let next = 0;
                    const worker = async () => {
                        while (id === sequence && next < messages.length) {
                            const index = next++;
                            let result;
                            try { result = await count(messages[index], capture.model); }
                            catch { result = { tokens: estimateTokens(messages[index]), mode: 'estimated' }; }
                            if (!Number.isFinite(result?.tokens) || result.tokens < 0) result = { tokens: estimateTokens(messages[index]), mode: 'estimated' };
                            capture.messageTokens[index] = result.tokens;
                            capture.messageModes[index] = result.mode;
                        }
                    };
                    await Promise.all(Array.from({ length: Math.min(4, messages.length) }, worker));
                    if (id === sequence) {
                        summarize(capture);
                        try { onUpdate(); } catch { /* UI failure is isolated */ }
                    }
                } catch { /* analysis failures must not escape into generation */ }
            }, 0);
        } catch { /* capture failures must not escape into generation */ }
    };
    eventSource.on(eventType, listener);
    return { getCurrent: () => current, stop: () => eventSource.removeListener(eventType, listener) };
}
