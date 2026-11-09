// Network waits are asynchronous; a bounded pool limits native processes and sockets.
const DEFAULT_SCAN_CONCURRENCY = 32;
const MAX_SCAN_CONCURRENCY = 128;
const MAX_ACTIVE_PROBES = 128;

function createProbeLimiter(limit = MAX_ACTIVE_PROBES) {
  let active = 0;
  const queue = [];
  function drain() {
    while (active < limit && queue.length) {
      const entry = queue.shift();
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted) { entry.reject(new Error('任务已停止')); continue; }
      active += 1;
      Promise.resolve().then(() => {
        if (entry.signal.aborted) throw new Error('任务已停止');
        return entry.work();
      }).then(entry.resolve, entry.reject).finally(() => { active -= 1; drain(); });
    }
  }
  return (work, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('任务已停止'));
    const entry = { work, signal, resolve, reject, abort: () => {
      const index = queue.indexOf(entry);
      if (index !== -1) queue.splice(index, 1);
      signal.removeEventListener('abort', entry.abort);
      reject(new Error('任务已停止'));
    } };
    queue.push(entry); signal.addEventListener('abort', entry.abort, { once: true }); drain();
  });
}

async function probeHost(ip, options, parentSignal, probes, limit) {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  let winner = null;
  const errors = [];
  const candidates = [];
  if (options.method !== 'tcp') candidates.push({ name: 'ICMP', run: () => probes.ping(ip, options.timeout, signal) });
  if (options.method !== 'icmp') for (const port of options.ports) candidates.push({ name: `TCP ${port}`, run: () => probes.tcp(ip, port, options.timeout, signal) });
  // All checks share a host cancellation signal. Finish only after losing probes release resources.
  await Promise.all(candidates.map(async candidate => {
    try {
      const result = await limit(candidate.run, signal);
      if (result?.status === 'reachable' && !winner && !parentSignal.aborted) {
        winner = result;
        controller.abort();
      }
    } catch (error) {
      if (!signal.aborted) errors.push(`${candidate.name}：${error.message}`);
    }
  }));
  if (parentSignal.aborted) throw new Error('任务已停止');
  if (winner) return winner;
  return { ip, status: errors.length ? 'error' : 'no-response', ms: null,
    method: options.method === 'combined' ? 'ICMP + TCP' : options.method.toUpperCase(),
    detail: errors.length ? `${errors.join('；')}；未获得有效响应` : '本次探测无响应，不能据此判断地址空闲' };
}
module.exports = { DEFAULT_SCAN_CONCURRENCY, MAX_SCAN_CONCURRENCY, MAX_ACTIVE_PROBES, createProbeLimiter, probeHost };
