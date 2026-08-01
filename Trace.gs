/**
 * Masrofna Bot - execution tracing.
 *
 * Hard rule: nothing in this file may ever throw. Tracing is a diagnostic,
 * and a diagnostic that can abort the request it is observing is worse than
 * no diagnostic at all. Every public function here swallows its own errors.
 *
 * Steps are written to Cloud Logging via console.log AND buffered, then
 * persisted at the end of doPost so /debug and the LAST_TRACE script
 * property can show them without the Executions UI.
 */

const TRACE_PROPERTY = 'LAST_TRACE';
const TRACE_MAX_CHARS = 7000;

/**
 * Per-execution buffer. A plain file-level var, deliberately not globalThis:
 * Apps Script's global object is a host object, so property assignment on it
 * is not guaranteed. Each execution gets a fresh global scope, so this is
 * one buffer per request.
 */
var TRACE_STATE = null;

function traceBuffer_() {
  if (!TRACE_STATE) {
    TRACE_STATE = { started: Date.now(), lines: [] };
  }
  return TRACE_STATE;
}

/** Records one step. Never throws. */
function trace_(step, details) {
  try {
    const buffer = traceBuffer_();
    const elapsed = Date.now() - buffer.started;

    let suffix = '';
    if (details !== undefined && details !== null) {
      suffix = ' ' + (typeof details === 'string' ? details : safeStringify_(details));
    }

    const line = '+' + String(elapsed) + 'ms  ' + step + suffix;
    buffer.lines.push(line);
    console.log(line);
  } catch (err) {
    // Last resort: a bare console.log has no dependencies of its own.
    try { console.log('trace_ failed for step ' + step); } catch (ignored) {}
  }
}

/** Records a failure, with the stack when one is available. Never throws. */
function traceError_(step, err) {
  try {
    const message = err && err.stack ? err.stack : String(err);
    const buffer = traceBuffer_();
    const elapsed = Date.now() - buffer.started;

    const line = '+' + String(elapsed) + 'ms  ERROR ' + step + ': ' + message;
    buffer.lines.push(line);
    console.error(line);
  } catch (nested) {
    try { console.error('traceError_ failed for step ' + step); } catch (ignored) {}
  }
}

/** Persists the buffer so /debug can read it back. Never throws. */
function traceSave_() {
  try {
    const text = traceBuffer_().lines.join('\n').slice(0, TRACE_MAX_CHARS);
    PropertiesService.getScriptProperties().setProperty(TRACE_PROPERTY, text);
  } catch (err) {
    try { console.error('traceSave_ failed: ' + err); } catch (ignored) {}
  }
}

/** Returns the last persisted trace, or a placeholder. Never throws. */
function traceLoad_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(TRACE_PROPERTY) ||
      '(no trace recorded yet)';
  } catch (err) {
    return '(could not read trace: ' + err + ')';
  }
}

/** Returns the current execution's trace so far, even if not yet saved. */
function traceCurrent_() {
  try {
    return traceBuffer_().lines.join('\n');
  } catch (err) {
    return '(no trace available)';
  }
}

/** JSON.stringify that never throws and never runs away in length. */
function safeStringify_(value) {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 1200 ? text.slice(0, 1200) + '...[truncated]' : text;
  } catch (err) {
    return '[unstringifiable]';
  }
}
