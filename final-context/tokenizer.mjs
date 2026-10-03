import { estimateTokens, tokenText } from './analyzer.mjs';

// The model-aware endpoint accepts complete message objects. It is the same
// endpoint used by SillyTavern's countTokensOpenAIAsync.
export function createCounter({ fetchImpl, headers, getTokenCountAsync }) {
    return async (message, model) => {
        // ST's model endpoint accepts objects, but several server tokenizer
        // branches stringify arrays/objects loosely. Their counts cannot
        // reliably represent image, audio, or tool payloads.
        const complex = typeof message?.content !== 'string' || Boolean(message?.tool_calls);
        if (model && !complex) {
            try {
                const response = await fetchImpl(`/api/tokenizers/openai/count?model=${encodeURIComponent(model)}`, {
                    method: 'POST', headers: headers(), body: JSON.stringify([message]),
                });
                if (response.ok) {
                    const value = (await response.json())?.token_count;
                    if (Number.isFinite(value) && value >= 0) return { tokens: Math.round(value), mode: 'tokenized' };
                }
            } catch { /* fall through */ }
        }
        try {
            const value = await getTokenCountAsync(tokenText(message));
            if (Number.isFinite(value) && value >= 0) return { tokens: Math.round(value), mode: complex ? 'estimated' : 'tokenized' };
        } catch { /* fall through */ }
        return { tokens: estimateTokens(message), mode: 'estimated' };
    };
}
