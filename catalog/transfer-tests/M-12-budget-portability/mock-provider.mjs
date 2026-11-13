// Controlled-replay mock provider (OpenAI-compatible /chat/completions).
// Purpose: observe exactly what the harness SENDS (tool count, schema bytes,
// token estimate) and inject controlled pathology (latency jitter, 429s,
// timeouts, partial failures) so the M-12 bench can be validated against a
// rate-limited peer rather than a model.
import { createServer } from 'node:http'
import { writeFileSync, appendFileSync } from 'node:fs'

const PORT = Number(process.env.MOCK_PORT || 4600)
const LOG  = process.env.MOCK_LOG  || '/mnt/data/opt/mock-provider/requests.jsonl'
// Pathology config (env):
//   MOCK_JITTER_MS     base added latency per request (default 0)
//   MOCK_JITTER_SPREAD random extra latency 0..spread (default 0)
//   MOCK_429_RATE      probability [0..1] of returning 429 (default 0)
//   MOCK_TIMEOUT_RATE  probability of a hanging/never-responding request (default 0)
//   MOCK_5XX_RATE      probability of returning 503 (default 0)
//   MOCK_TPM           token-per-minute ceiling to simulate provider quota (default 0=off)
//   MOCK_MAX_CONC      concurrent-request ceiling (default 0=off)
const cfg = {
  jitterMs:    Number(process.env.MOCK_JITTER_MS || 0),
  jitterSpread:Number(process.env.MOCK_JITTER_SPREAD || 0),
  p429:        Number(process.env.MOCK_429_RATE || 0),
  pTimeout:    Number(process.env.MOCK_TIMEOUT_RATE || 0),
  p5xx:        Number(process.env.MOCK_5XX_RATE || 0),
  tpm:         Number(process.env.MOCK_TPM || 0),
  maxConc:     Number(process.env.MOCK_MAX_CONC || 0),
}
let inflight = 0, minuteTokens = 0, minute = 0, reqCount = 0

const sleep = ms => new Promise(r => setTimeout(r, ms))

createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); return res.end('{}') }
  let body = ''
  for await (const c of req) body += c
  let j = {}; try { j = JSON.parse(body) } catch {}

  const tools = j.tools || []
  const toolBytes = tools.reduce((s,t)=> s + JSON.stringify(t).length, 0)
  const approxTokens = Math.round(body.length / 3.6)
  reqCount++
  const nowMin = Math.floor(Date.now()/60000)
  if (nowMin !== minute) { minute = nowMin; minuteTokens = 0 }

  const record = {
    seq: reqCount, at: new Date().toISOString(),
    model: j.model,
    tool_count: tools.length,
    tool_schema_bytes: toolBytes,
    request_bytes: body.length,
    approx_prompt_tokens: approxTokens,
    message_count: (j.messages||[]).length,
    inflight_at_arrival: inflight,
    tpm_ceiling: cfg.tpm, tokens_used_this_minute: minuteTokens,
    pathology: cfg
  }
  appendFileSync(LOG, JSON.stringify(record)+'\n')

  inflight++
  try {
    if (cfg.maxConc && inflight > cfg.maxConc) {
      res.writeHead(429, {'content-type':'application/json','retry-after':'1'})
      return res.end(JSON.stringify({error:{message:'concurrency ceiling',type:'rate_limit'}}))
    }
    if (cfg.pTimeout && Math.random() < cfg.pTimeout) {
      record.outcome='timeout'; appendFileSync(LOG, JSON.stringify(record)+'\n')
      return; // never respond
    }
    if (cfg.p429 && Math.random() < cfg.p429) {
      record.outcome='429'; appendFileSync(LOG, JSON.stringify(record)+'\n')
      res.writeHead(429, {'content-type':'application/json','retry-after':'2'})
      return res.end(JSON.stringify({error:{message:'rate limited',type:'rate_limit'}}))
    }
    if (cfg.p5xx && Math.random() < cfg.p5xx) {
      record.outcome='503'; appendFileSync(LOG, JSON.stringify(record)+'\n')
      res.writeHead(503, {'content-type':'application/json'})
      return res.end(JSON.stringify({error:{message:'service unavailable'}}))
    }
    const lat = cfg.jitterMs + Math.floor(Math.random()*(cfg.jitterSpread+1))
    if (lat) await sleep(lat)
    const text = 'OK'
    const promptTokens = approxTokens
    minuteTokens += promptTokens
    record.outcome='200'; record.latency_ms=lat; record.prompt_tokens=promptTokens
    appendFileSync(LOG, JSON.stringify(record)+'\n')
    res.writeHead(200, {'content-type':'application/json'})
    res.end(JSON.stringify({
      id:'chatcmpl-mock-'+reqCount, object:'chat.completion', created:Math.floor(Date.now()/1000),
      model:j.model||'mock',
      choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],
      usage:{prompt_tokens:promptTokens, completion_tokens:1, total_tokens:promptTokens+1}
    }))
  } finally { inflight-- }
}).listen(PORT, '127.0.0.1', () => {
  writeFileSync('/mnt/data/opt/mock-provider/config.json', JSON.stringify({port:PORT, log:LOG, pathology:cfg},null,1))
  console.log(`mock-provider listening on http://127.0.0.1:${PORT}  pathology=${JSON.stringify(cfg)}`)
})
