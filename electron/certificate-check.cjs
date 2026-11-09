// TLS diagnostics: collect certificate evidence without sending application data.
const net = require("node:net");
const tls = require("node:tls");

function certificateDetails(
  cert,
  expectedName,
  authorized,
  authorizationError,
  warnDays,
  now = Date.now(),
) {
  const validFrom = Date.parse(cert.valid_from),
    validTo = Date.parse(cert.valid_to);
  const datesKnown = Number.isFinite(validFrom) && Number.isFinite(validTo);
  const expired = datesKnown && validTo <= now,
    notYetValid = datesKnown && validFrom > now;
  const daysRemaining = datesKnown
    ? Math.ceil((validTo - now) / 86400000)
    : null;
  const mismatch = tls.checkServerIdentity(expectedName, cert);
  const chain = [];
  let current = cert;
  const seen = new Set();
  while (
    current?.raw &&
    chain.length < 10 &&
    !seen.has(current.fingerprint256)
  ) {
    seen.add(current.fingerprint256);
    chain.push({
      subject: current.subject,
      issuer: current.issuer,
      validFrom: current.valid_from,
      validTo: current.valid_to,
      fingerprint: current.fingerprint256,
    });
    current = current.issuerCertificate;
  }
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    serial: cert.serialNumber,
    fingerprint: cert.fingerprint256,
    subjectAltName: cert.subjectaltname || "",
    validFrom: cert.valid_from,
    validTo: cert.valid_to,
    daysRemaining,
    expired,
    notYetValid,
    expiring:
      datesKnown && !expired && !notYetValid && daysRemaining <= warnDays,
    trusted: !!authorized,
    trustError: authorized
      ? ""
      : String(authorizationError || "证书链不受信任"),
    nameMatches: !mismatch,
    nameError: mismatch?.message || "",
    valid: datesKnown && !expired && !notYetValid && authorized && !mismatch,
    chain,
  };
}
/**
 * Read server-provided TLS certificate evidence, including invalid certificates.
 * @param {string} ip Resolved target address.
 * @param {{port: number, servername: string, timeout: number, warnDays: number}} options
 * timeout is handshake time in ms; servername is SNI and the expected identity.
 * @param {AbortSignal} signal
 * @returns {Promise<Object>} Certificate validity, trust, name, chain and TLS metadata.
 * A trust/name failure is returned as diagnostic data; IO/abort failures reject.
 */
function inspectCertificate(ip, options, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("任务已停止"));
    let socket,
      settled = false;
    const abort = () => finish(new Error("任务已停止"));
    const handshakeTimeoutTimer = setTimeout(
      () => finish(new Error("TLS 握手超时")),
      options.timeout,
    );
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(handshakeTimeoutTimer);
      signal.removeEventListener("abort", abort);
      socket?.destroy();
      if (error) reject(error);
      else resolve(result);
    }
    signal.addEventListener("abort", abort, { once: true });
    // Diagnostic handshake only: collect invalid certificates and report trust failures explicitly.
    // No application data or credentials are sent over this inspection socket.
    socket = tls.connect(
      {
        host: ip,
        port: options.port,
        servername: net.isIP(options.servername)
          ? undefined
          : options.servername,
        rejectUnauthorized: false,
        checkServerIdentity: (_, cert) =>
          tls.checkServerIdentity(options.servername, cert),
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          if (!cert.raw) throw new Error("目标未提供可读取的证书");
          finish(null, {
            ...certificateDetails(
              cert,
              options.servername,
              socket.authorized,
              socket.authorizationError,
              options.warnDays,
            ),
            protocol: socket.getProtocol(),
            cipher: socket.getCipher()?.name,
            checkedAt: new Date().toISOString(),
            expectedName: options.servername,
          });
        } catch (error) {
          finish(error);
        }
      },
    );
    socket.once("error", (error) =>
      finish(new Error(`TLS 检查失败：${error.code || error.message}`)),
    );
    socket.once("close", () => {
      if (!settled) finish(new Error("TLS 连接提前关闭"));
    });
  });
}

module.exports = { certificateDetails, inspectCertificate };
