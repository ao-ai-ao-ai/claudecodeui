/**
 * Geel provider adapter.
 *
 * Routes chat messages through the GEEL/NC Conductor WebSocket instead of
 * siteboon's embedded Claude Agent SDK. This is the wedge that lets the
 * siteboon shell use Claude Max (via the nerve-center ConductorSession.js
 * CLI spawn) while preserving all of siteboon's UI: session list, project
 * switcher, file tree, MCP config, tool permissions.
 *
 * Session history is stored in the SAME `~/.claude/projects/*\/*.jsonl` files
 * that Claude CLI writes to, so geel's fetchHistory delegates to the claude
 * adapter. Live events flow through Conductor's WebSocket format, which
 * normalizeMessage maps into NormalizedMessage.
 *
 * @module providers/geel
 */

import { claudeAdapter } from '../claude/adapter.js';
import { createNormalizedMessage, generateMessageId } from '../types.js';

const PROVIDER = 'geel';

/**
 * Session-ID remap table.
 *
 * geel-cli.js mints a random UUID for the frontend WS session before Claude
 * CLI starts. Claude CLI then reports its own `session_id` on the final
 * `result` frame. The UI navigates to `/session/<real>` after turn-done, so
 * any realtime frame tagged with the minted UUID lands in an orphan store
 * bucket that the rendered view never reads (P1-N2 Gate 1 item 4: CostChip
 * never renders).
 *
 * Fix: on the first `result` of a session whose real ID differs from the
 * minted one, emit a synthetic `session_created` frame (routed through the
 * minted bucket so `useChatRealtimeHandlers.ts:227` picks it up and promotes
 * currentSessionId + URL), then tag the cost `status` frame with the REAL
 * sessionId so it lands in the bucket the navigated view will actually read.
 * All subsequent frames in this session continue to ship under the real ID.
 *
 * Keyed by minted sessionId → { realId, migrated }. Bounded in practice by
 * active WS sessions; entries grow with the process but are small.
 */
const sessionRemap = new Map();

/**
 * Fetch persisted history.
 * Geel sessions live in the same JSONL files as Claude CLI sessions because
 * our ConductorSession.js spawns `claude -p --resume <id>` under the hood.
 * Delegate to the claude adapter and re-tag the provider.
 *
 * @param {string} sessionId
 * @param {import('../types.js').FetchHistoryOptions} [opts]
 * @returns {Promise<import('../types.js').FetchHistoryResult>}
 */
export async function fetchHistory(sessionId, opts = {}) {
  const result = await claudeAdapter.fetchHistory(sessionId, opts);
  return {
    ...result,
    messages: result.messages.map(m => ({ ...m, provider: PROVIDER })),
  };
}

/**
 * Normalize a single Conductor WebSocket event into NormalizedMessage[].
 * Conductor event shapes (from nerve-center/src/core/ConductorSession.js):
 *   { type: 'reasoning_delta', content, ts }
 *   { type: 'tool_input',  toolName, input, toolId, ts }
 *   { type: 'tool_output', toolId, content, isError, ts }
 *   { type: 'text_delta',  content, ts }
 *   { type: 'message_complete', exitCode, ts }
 *   { type: 'rate_limit',  info, ts }
 *   { type: 'context_rotated', reason, usedPct?, error?, ts }
 *   { type: 'error',  content, reason?, elapsed_ms?, ts }
 *   { type: 'session_init', sessionId, ts }
 *
 * Anything we don't recognize falls through to claudeAdapter.normalizeMessage
 * so we inherit full JSONL history support for free.
 *
 * @param {any} raw
 * @param {string} sessionId
 * @returns {import('../types.js').NormalizedMessage[]}
 */
export function normalizeMessage(raw, sessionId) {
  const remap = sessionRemap.get(sessionId);
  const effectiveSid = remap?.realId || sessionId;
  const base = { sessionId: effectiveSid, provider: PROVIDER };
  const ts = raw.ts ? new Date(raw.ts).toISOString() : new Date().toISOString();

  switch (raw.type) {
    case 'reasoning_delta':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'thinking', content: raw.content,
      })];

    case 'text_delta':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'stream_delta', content: raw.content,
      })];

    case 'tool_input':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'tool_use',
        toolName: raw.toolName, toolInput: raw.input, toolId: raw.toolId,
      })];

    case 'tool_output':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'tool_result',
        toolId: raw.toolId, content: raw.content, isError: !!raw.isError,
      })];

    case 'message_complete':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'complete',
      })];

    case 'result': {
      const realId = raw.sessionId;
      const costText = `${raw.model || 'Claude'} · ${raw.duration ? `${raw.duration}ms` : ''} · $${raw.cost ? raw.cost.toFixed(4) : '0'}`;
      const needsMigration = realId && realId !== sessionId && !remap?.migrated;

      if (needsMigration) {
        sessionRemap.set(sessionId, { realId, migrated: true });
        return [
          // Route migration frame through the MINTED bucket so the current
          // view's realtime handler promotes currentSessionId → realId.
          createNormalizedMessage({
            sessionId,
            provider: PROVIDER,
            timestamp: ts,
            kind: 'session_created',
            newSessionId: realId,
          }),
          // Cost frame MUST land in the REAL bucket — that's where the
          // post-navigation view will read from.
          createNormalizedMessage({
            sessionId: realId,
            provider: PROVIDER,
            timestamp: ts,
            kind: 'status',
            text: costText,
            costUsd: raw.cost,
            duration: raw.duration,
            model: raw.model,
          }),
        ];
      }

      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'status',
        text: costText,
        costUsd: raw.cost,
        duration: raw.duration,
        model: raw.model,
      })];
    }

    case 'rate_limit':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'status',
        text: `rate-limit ${raw.info?.input_tokens_used || 0}/${raw.info?.input_tokens_limit || 0}`,
        tokens: raw.info?.input_tokens_used,
      })];

    case 'context_rotated':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'status',
        text: `context rotated (${raw.reason}${raw.usedPct ? ` @ ${(raw.usedPct * 100).toFixed(0)}%` : ''})`,
      })];

    case 'error':
      return [createNormalizedMessage({
        ...base, timestamp: ts, kind: 'error',
        content: raw.content + (raw.reason ? ` [${raw.reason}]` : ''),
      })];

    case 'session_init': {
      const realId = raw.sessionId;
      if (realId && realId !== sessionId && !remap?.migrated) {
        sessionRemap.set(sessionId, { realId, migrated: true });
      }
      return [createNormalizedMessage({
        sessionId, // keep minted here so the migration handler finds the old bucket
        provider: PROVIDER,
        timestamp: ts,
        kind: 'session_created',
        newSessionId: realId,
      })];
    }

    default:
      return claudeAdapter.normalizeMessage(raw, sessionId)
        .map(m => ({ ...m, provider: PROVIDER }));
  }
}

export const geelAdapter = { fetchHistory, normalizeMessage };
