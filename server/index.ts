import { createServer } from 'node:http'
import { demoScene } from './scene'

const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '127.0.0.1'
const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173'
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method === 'GET' && req.url === '/api/health') res.end(JSON.stringify({ status: 'ok' }))
  else if (req.method === 'GET' && req.url === '/api/scene') res.end(JSON.stringify(demoScene))
  else { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })) }
})
server.listen(port, host)
