import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
http.createServer(async (request, response) => {
    const file = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + '\\')) { response.writeHead(403).end(); return; }
    try {
        response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'text/plain');
        response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
}).listen(8765, '127.0.0.1');
