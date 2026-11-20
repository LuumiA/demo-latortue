// Petit serveur statique local pour tester la démo : npm start  →  http://localhost:4173
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'site')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = normalize(join(root, path === '/' ? 'index.html' : path))
  if (!file.startsWith(root)) { res.writeHead(403).end(); return }
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file))
  } catch {
    res.writeHead(404).end('Introuvable')
  }
}).listen(4173, '127.0.0.1', () => console.log('Démo : http://localhost:4173'))
