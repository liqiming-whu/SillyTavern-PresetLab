export function readableMessage(message) {
    if (typeof message?.content === 'string' && !message.tool_calls && !message.reasoning_content) return message.content;
    return JSON.stringify(message, (key, value) => {
        if (typeof value === 'string' && value.startsWith('data:') && value.length > 200) return `[embedded media: ${value.length} characters]`;
        return value;
    }, 2) ?? '';
}

export function tokenText(message) {
    const content = typeof message?.content === 'string' ? message.content
        : Array.isArray(message?.content) ? message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n')
            : message?.content && typeof message.content === 'object' ? JSON.stringify(message.content, (key, value) => typeof value === 'string' && value.startsWith('data:') ? '[embedded media]' : value) : '';
    return [message?.role, message?.name, content, message?.reasoning_content,
        message?.tool_call_id, message?.tool_calls ? JSON.stringify(message.tool_calls) : '']
        .filter(Boolean).join('\n');
}

export function estimateTokens(message) {
    return Math.ceil(new TextEncoder().encode(tokenText(message)).length / 3.35);
}

export function summarize(capture) {
    const roles = new Map();
    capture.messageTokens.forEach((tokens, index) => {
        const role = String(capture.messages[index]?.role || 'unknown');
        roles.set(role, (roles.get(role) || 0) + tokens);
    });
    capture.roleSummary = [...roles].map(([role, tokens]) => ({ role, tokens }));
    capture.totalTokens = capture.messageTokens.reduce((sum, tokens) => sum + tokens, 0);
    capture.tokenMode = capture.messageModes.every(mode => mode === 'tokenized') ? 'tokenized' : 'estimated';
    return capture;
}
