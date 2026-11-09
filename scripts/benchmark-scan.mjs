import native from '../electron/network.cjs';

// Local loopback only; does not enumerate or scan the user's LAN.
for (const concurrency of [8, 32]) {
  for (const method of ['icmp', 'combined']) {
    const start = performance.now();
    const finished = Promise.withResolvers();
    const tasks = new native.NetworkTasks(() => {}, async record => finished.resolve(record));
    await tasks.start('scan', { target: '127.0.0.2-127.0.0.33', timeout: 300, ports: '80,443', method, concurrency });
    const result = await finished.promise;
    console.log(JSON.stringify({ platform:process.platform, node:process.version, method, concurrency,
      addresses:result.completed, responsive:result.received, errors:result.rows.filter(row=>row.status==='error').length,
      timeout:300, elapsedMs:Math.round(performance.now()-start) }));
  }
}
