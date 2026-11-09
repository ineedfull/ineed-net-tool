/**
 * Runtime task events contain metadata snapshots and optional result deltas.
 * `row`, `rows` and `pingLogEntry` append to local collections; other fields
 * replace metadata. The first event may arrive before start() returns its ID.
 * Native final events follow result flushing and the history-save attempt.
 * A saveError describes persistence failure independently of probe status.
 *
 * @typedef {Object} TaskEvent
 * @property {string} id Identity of one task execution, not its project.
 * @property {string} kind Tool kind (scan, ping, route, dns, ports, etc.).
 * @property {string} [status] running/paused/stopping or a terminal status.
 * @property {Object} [row] One new result row.
 * @property {Object[]} [rows] Batch of new result rows; takes precedence over row.
 * @property {Object} [pingLogEntry] One raw Ping execution entry.
 * @property {Object} [summary] Tool-specific latest aggregate; replaces the old one.
 * @property {number} [completed] Count across the whole run, including trimmed rows.
 * @property {string} [error] Probe/execution failure.
 * @property {string} [saveError] History could not be persisted.
 * @property {Object} [historyRecord] Successfully saved terminal record; owned
 * by the history collection, never copied into live task metadata.
 */

const FULL_RESULT_KINDS = new Set(["scan", "ports", "dns"]);
const RECENT_RESULT_LIMIT = 500;

/**
 * Merge an event into the current task, refusing events from an older execution.
 * prepareRow lets the Vue caller mark records raw without coupling this module
 * to Vue. It must preserve each record's data and return the prepared object.
 * @param {Object | undefined} task Mutable UI task with a rows array.
 * @param {TaskEvent} event
 * @param {{prepareRow?: (row: Object) => Object}} [options]
 * @returns {boolean} Whether the event belongs to this task and was applied.
 */
export function mergeTaskEvent(
  task,
  event,
  { prepareRow = (row) => row } = {},
) {
  if (!task || (task.id && task.id !== event.id)) return false;

  const { row, rows, pingLogEntry, historyRecord, ...metadata } = event;
  if (pingLogEntry) {
    task.pingLog ||= [];
    task.pingLog.push(prepareRow(pingLogEntry));
    if (task.pingLog.length > RECENT_RESULT_LIMIT) task.pingLog.shift();
  }

  Object.assign(task, metadata);
  const additions = rows || (row ? [row] : []);
  if (additions.length) {
    task.rows.push(...additions.map((result) => prepareRow(result)));
    if (
      !FULL_RESULT_KINDS.has(event.kind) &&
      task.rows.length > RECENT_RESULT_LIMIT
    ) {
      task.rows.splice(0, task.rows.length - RECENT_RESULT_LIMIT);
    }
  }
  return true;
}

export function isTerminalTaskStatus(status) {
  return ["completed", "stopped", "error"].includes(status);
}
