/**
 * Geel provider runner.
 *
 * Forwards chat commands from siteboon's WS to nerve-center's Conductor WS
 * (ws://<NERVE_CENTER>/ws/conductor?projectSlug=X). Nerve-center spawns
 * `claude -p --resume <sid>` under Claude Max OAuth (SDK cannot reach that
 * auth; this hop lets siteboon's UI drive it anyway).
 *
 * Each upstream event is normalized via geelAdapter.normalizeMessage and
 * sent to the browser as NormalizedMessage through the WebSocketWriter.
 *
 * @module geel-cli
 */

import WebSocket from 'ws';
import { geelAdapter } from './providers/geel/adapter.js';

const NERVE_CENTER_WS =
  process.env.NERVE_CENTER_WS || 'ws://localhost:3333/ws/conductor';

const ABORT_TIMEOUT_MS = 5000;

/** sessionId (writer) → { upstream, inflight } */
const activeSessions = new Map();

/**
 * Public API — mirrors queryClaudeSDK/spawnCursor signatures used in
 * server/index.js WS dispatcher.
 *
 * @param {string} command - User prompt
 * @param {object} options - { projectPath, projectSlug, sessionId, mode, brain }
 * @param {object} writer  - WebSocketWriter instance (writer.send({...}))
 */
export async function queryGeel(command, options = {}, writer) {
  const slug = options.projectSlug
    || (options.projectPath ? options.projectPath.split('/').pop() : null);
  const sessionId = options.sessionId || `geel-${Date.now()}`;
  writer.setSessionId(sessionId);

  // Prefer verbatim projectPath as cwd — siteboon's slug is the sanitized
  // directory name (e.g. "-home-ubuntu-ai-os-projects-opulent-arrival"),
  // not a usable slug. Nerve-center server.js:13781 honors `cwd` param
  // override; fall back to projectSlug only when no path is given.
  const cwd = options.projectPath || null;
  const qs = new URLSearchParams();
  if (cwd) qs.set('cwd', cwd);
  if (slug) qs.set('projectSlug', slug);
  const url = qs.toString() ? `${NERVE_CENTER_WS}?${qs}` : NERVE_CENTER_WS;

  // Reuse upstream if already connected for this writer/session
  let entry = activeSessions.get(sessionId);
  if (!entry || entry.upstream.readyState !== WebSocket.OPEN) {
    entry = await openUpstream(url, sessionId, writer);
    activeSessions.set(sessionId, entry);
  }

  // Send the user message down the Conductor wire
  entry.upstream.send(JSON.stringify({
    type: 'message',
    content: command,
    mode: options.mode || 'build',
    brain: options.brain || 'auto',
    projectSlug: slug || null,
  }));
}

/**
 * Open a WS to nerve-center's Conductor and pipe its frames into the
 * client writer after normalizing to NormalizedMessage.
 */
function openUpstream(url, sessionId, writer) {
  return new Promise((resolve, reject) => {
    const upstream = new WebSocket(url);
    const entry = { upstream, inflight: true };

    const timeout = setTimeout(() => {
      reject(new Error(`Conductor WS did not open within 10s: ${url}`));
      try { upstream.close(); } catch {}
    }, 10_000);

    upstream.on('open', () => {
      clearTimeout(timeout);
      writer.send({
        id: `status_${Date.now()}`,
        sessionId,
        timestamp: new Date().toISOString(),
        provider: 'geel',
        kind: 'status',
        text: 'conductor connected',
      });
      resolve(entry);
    });

    upstream.on('message', (raw) => {
      let parsed;
      try { parsed = JSON.parse(raw.toString()); }
      catch { return; }

      const msgs = geelAdapter.normalizeMessage(parsed, sessionId);
      for (const m of msgs) writer.send(m);

      // Any message means upstream is alive — clear inflight gate
      entry.inflight = false;
    });

    upstream.on('close', (code, reason) => {
      activeSessions.delete(sessionId);
      writer.send({
        id: `status_${Date.now()}`,
        sessionId,
        timestamp: new Date().toISOString(),
        provider: 'geel',
        kind: 'status',
        text: `conductor closed (${code} ${reason || ''})`.trim(),
      });
    });

    upstream.on('error', (err) => {
      clearTimeout(timeout);
      writer.send({
        id: `err_${Date.now()}`,
        sessionId,
        timestamp: new Date().toISOString(),
        provider: 'geel',
        kind: 'error',
        content: `Conductor WS error: ${err.message}`,
      });
      activeSessions.delete(sessionId);
      reject(err);
    });
  });
}

/** Abort the current inflight turn for this sessionId. */
export async function abortGeelSession(sessionId) {
  const entry = activeSessions.get(sessionId);
  if (!entry) return false;
  try {
    entry.upstream.send(JSON.stringify({ type: 'kill' }));
  } catch {}
  await new Promise(r => setTimeout(r, ABORT_TIMEOUT_MS));
  try { entry.upstream.close(); } catch {}
  activeSessions.delete(sessionId);
  return true;
}

export function isGeelSessionActive(sessionId) {
  const entry = activeSessions.get(sessionId);
  return !!entry && entry.upstream.readyState === WebSocket.OPEN;
}

export function getActiveGeelSessions() {
  return Array.from(activeSessions.keys());
}
