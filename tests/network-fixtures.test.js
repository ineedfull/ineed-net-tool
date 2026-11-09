import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import fixtureModule from './helpers/network-fixtures.cjs';

test('plain TCP fixture closes after receiving a rejected TLS ClientHello', async () => {
  const fixtures = await fixtureModule.fixtures();
  const socket = tls.connect({ host: '127.0.0.1', port: fixtures.openPort, rejectUnauthorized: false });
  socket.on('error', () => {});
  await new Promise(resolve => socket.once('close', resolve));
  let timer;
  try {
    await Promise.race([
      fixtures.close(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture close retained a paused socket after TLS ClientHello')), 1000); }),
    ]);
    assert.equal(socket.destroyed, true);
  } finally { clearTimeout(timer); socket.destroy(); }
});
