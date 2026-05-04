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
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { geelAdapter } from './providers/geel/adapter.js';

const NERVE_CENTER_WS =
  process.env.NERVE_CENTER_WS || 'ws://localhost:3333/ws/conductor';

const ABORT_TIMEOUT_MS = 5000;

// Conductor spawns `claude --dangerously-skip-permissions`. Any cwd we forward
// becomes shell access in that directory. Allowlist project roots — siteboon
// passes user-controlled `projectPath` from the WS message, so we validate
// here in addition to nerve-center's upgrade-time check (defense in depth).
const HOME = os.homedir();
const ALLOWED_CWD_ROOTS = [
  path.join(HOME, 'projects'),
  path.join(HOME, 'ai-os'),
  path.join(HOME, 'nerve-center'),
];

function safeProjectPath(p) {
  if (!p || typeof p !== 'string') return null;
  const resolved = path.resolve(p);
  const ok = ALLOWED_CWD_ROOTS.some(
    r => resolved === r || resolved.startsWith(r + path.sep)
  );
  return ok ? resolved : null;
}

function safeProjectSlug(s) {
  if (!s || typeof s !== 'string') return null;
  if (s.length === 0 || s.length >= 128) return null;
  if (s.includes('/') || s.includes('..') || s.includes('\0')) return null;
  return s;
}

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
  // Validate inputs against allowlist — siteboon's WS dispatcher passes user-
  // supplied `data.options` through verbatim, so projectPath is attacker-
  // controlled in the threat model. Reject anything outside the allowed roots
  // before forwarding to Conductor.
  const cwd = safeProjectPath(options.projectPath);
  const rawSlug = options.projectSlug
    || (options.projectPath ? options.projectPath.split('/').pop() : null);
  const slug = safeProjectSlug(rawSlug);

  if (options.projectPath && !cwd) {
    writer.send({
      id: `err_${Date.now()}`,
      sessionId: options.sessionId || 'pre-session',
      timestamp: new Date().toISOString(),
      provider: 'geel',
      kind: 'error',
      content: `projectPath outside allowed roots (${ALLOWED_CWD_ROOTS.join(', ')})`,
    });
    return;
  }

  const freshSession = !options.sessionId;
  const sessionId = options.sessionId || randomUUID();
  writer.setSessionId(sessionId);

  // Emit a synthetic session_created when we minted the ID ourselves.
  // The UI's useChatRealtimeHandlers `session_created` handler promotes
  // the URL to /session/<uuid> — without this, first-send-from-root leaves
  // the user stranded at / with an orphan bubble (P1-N2-verify item 3).
  if (freshSession) {
    writer.send({
      id: `session_created_${Date.now()}`,
      sessionId,
      timestamp: new Date().toISOString(),
      provider: 'geel',
      kind: 'session_created',
      newSessionId: sessionId,
    });
  }

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

  // Send the user message down the Conductor wire.
  // DO NOT include projectSlug here — nerve-center's WS handler
  // (server.js:13802) rebuilds cwd from slug as $HOME/projects/<slug>,
  // which clobbers the cwd we set at the URL level on open. The session's
  // cwd is already correct from the initial upgrade; slug-on-message
  // would re-route to the wrong path.
  entry.upstream.send(JSON.stringify({
    type: 'message',
    content: command,
    mode: options.mode || 'build',
    brain: options.brain || 'auto',
  }));
}

/**
 * Open a WS to nerve-center's Conductor and pipe its frames into the
 * client writer after normalizing to NormalizedMessage.
 */
function openUpstream(url, sessionId, writer) {
  return new Promise((resolve, reject) => {
    // Mutable — updated when Conductor assigns its real CLI session ID
    // via session_init so subsequent messages (including result/CostChip)
    // carry the correct session key.
    let effectiveSessionId = sessionId;
    const upstream = new WebSocket(url);
    const entry = { upstream, inflight: true, conductorSessionId: null };

    const timeout = setTimeout(() => {
      reject(new Error(`Conductor WS did not open within 10s: ${url}`));
      try { upstream.close(); } catch {}
    }, 10_000);

    upstream.on('open', () => {
      clearTimeout(timeout);
      writer.send({
        id: `status_${Date.now()}`,
        sessionId: effectiveSessionId,
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

      // Session-ID remap is driven by the adapter's `result` handler —
      // Conductor's session_init only carries {model, cwd, ts}. The CLI's
      // real sessionId arrives on the final `result` frame.
      const msgs = geelAdapter.normalizeMessage(parsed, effectiveSessionId);
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
