import { readableMessage } from './analyzer.mjs';

export function toMarkdown(capture) {
    const lines = ['# SillyTavern Final Context', '',
        `Model: ${capture.model || 'Unknown'}`, `Provider: ${capture.provider || 'Unknown'}`,
        `Captured: ${capture.timestamp}`, `Total Tokens: ${capture.totalTokens} (${capture.tokenMode})`,
        '', '## Token Summary', '', '| Role | Tokens | Percentage |', '|---|---:|---:|'];
    for (const item of capture.roleSummary) {
        lines.push(`| ${item.role.replaceAll('|', '\\|')} | ${item.tokens} | ${capture.totalTokens ? (item.tokens / capture.totalTokens * 100).toFixed(1) : '0.0'}% |`);
    }
    capture.messages.forEach((message, index) => {
        const content = readableMessage(message);
        let fenceLength = 3;
        for (const match of content.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
        const fence = '`'.repeat(fenceLength);
        lines.push('', `## Message ${index + 1}`, '', `Role: ${message?.role || 'unknown'}`,
            `Tokens: ${capture.messageTokens[index]} (${capture.messageModes[index]})`, '',
            `${fence}text`, content, fence);
    });
    return lines.join('\n') + '\n';
}
