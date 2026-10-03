import http from 'node:http';

http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url.endsWith('/models')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ data: [{ id: 'preset-lab-smoke', object: 'model' }] }));
        return;
    }
    if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
        response.writeHead(404).end(); return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: ' + JSON.stringify({ id: 'smoke', choices: [{ index: 0, delta: { content: 'Smoke response' }, finish_reason: null }] }) + '\n\n');
        response.end('data: [DONE]\n\n');
    } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ id: 'smoke', choices: [{ index: 0, message: { role: 'assistant', content: 'Smoke response' }, finish_reason: 'stop' }] }));
    }
}).listen(8767, '127.0.0.1');
