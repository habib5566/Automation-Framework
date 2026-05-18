const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DEMO_PORT || 3789);
const ROOT = path.join(__dirname, 'demo-app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function safeJoin(root, requestPath) {
  const raw = decodeURIComponent(requestPath.split('?')[0] || '/');
  const trimmed = raw.replace(/^\/+/, '');
  const relative = trimmed === '' ? 'index.html' : trimmed;
  const normalized = path.normalize(path.join(root, relative));
  if (!normalized.startsWith(root)) return null;
  return normalized;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/login') {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const { username, password } = body;
        if (username === 'admin' && password === 'admin123') {
          send(res, 200, JSON.stringify({ ok: true, redirect: '/dashboard.html' }), 'application/json');
        } else {
          send(
            res,
            401,
            JSON.stringify({ ok: false, message: 'Invalid username or password.' }),
            'application/json'
          );
        }
      } catch {
        send(res, 400, JSON.stringify({ ok: false, message: 'Malformed request.' }), 'application/json');
      }
    });
    return;
  }

  const filePath = safeJoin(ROOT, req.url || '/');
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath);
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Demo app listening on http://localhost:${PORT}`);
});
