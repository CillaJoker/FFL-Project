const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

function parseEnv(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((acc, line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        acc[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      }
      return acc;
    }, {});
  } catch (e) {
    console.log(`.env error: ${e.message}`);
    return {};
  }
}

const env = parseEnv(path.join(ROOT, '.env'));

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/config.js') {
    const js = `var APP_CONFIG = {\n  GROQ_API_KEY: ${JSON.stringify(env.GROQ_API_KEY || '')},\n  RAPIDAPI_KEY: ${JSON.stringify(env.RAPID_API_KEY || '')},\n};\n`;
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(js);
    return;
  }

  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`FFL Advisor running at http://localhost:${PORT}`));
