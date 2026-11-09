// Streaming download measurement; owns requests, responses and its timers.
const http = require("node:http");
const https = require("node:https");

function downloadUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("请输入完整的 HTTP / HTTPS 下载地址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("测速仅支持不含账号密码的 HTTP / HTTPS 地址");
  url.hash = "";
  return url.href;
}
/**
 * Measure a streaming response without saving its body.
 * @param {{target: string, timeout: number, duration: number, maxMiB: number}} options
 * timeout is the connection/data idle limit in ms; duration is body time in s.
 * @param {AbortSignal} signal
 * @param {(snapshot: Object) => void} progress Receives periodic and final snapshots.
 * @returns {Promise<Object>} Final bytes/elapsedMs/mbps/reason/url snapshot.
 * Abort or transport failure rejects after publishing the partial final snapshot.
 */
function measureDownload(options, signal, progress) {
  return new Promise((resolve, reject) => {
    let request,
      response,
      durationTimer,
      idleTimeoutTimer,
      progressIntervalTimer,
      settled = false,
      bytes = 0,
      bodyStartedAt = null,
      finalUrl = options.target;
    const maxDownloadBytes = options.maxMiB * 1024 * 1024;
    const createSnapshot = (reason) => {
      const elapsedMs =
        bodyStartedAt === null
          ? 0
          : Math.max(1, performance.now() - bodyStartedAt);
      return {
        bytes,
        elapsedMs,
        mbps: elapsedMs ? (bytes * 8) / elapsedMs / 1000 : 0,
        reason,
        url: finalUrl,
      };
    };
    const abort = () => finish(new Error("任务已停止"));
    // All response/request callbacks settle here once. Publish partial evidence
    // after releasing resources so cancellation still retains measured traffic.
    function finish(error, reason) {
      if (settled) return;
      settled = true;
      clearTimeout(durationTimer);
      clearTimeout(idleTimeoutTimer);
      clearInterval(progressIntervalTimer);
      signal.removeEventListener("abort", abort);
      response?.destroy();
      request?.destroy();
      const result = createSnapshot(
        reason || (signal.aborted ? "stopped" : "error"),
      );
      progress(result);
      if (error) reject(error);
      else resolve(result);
    }
    function resetIdleTimeout() {
      clearTimeout(idleTimeoutTimer);
      idleTimeoutTimer = setTimeout(
        () => finish(new Error("下载连接或数据等待超时")),
        options.timeout,
      );
    }
    function openDownload(url, redirectCount = 0) {
      if (settled) return;
      finalUrl = url;
      resetIdleTimeout();
      const activeRequest = (url.startsWith("https:") ? https : http).get(
        url,
        {
          headers: {
            "Accept-Encoding": "identity",
            "User-Agent": "Ineed-NetTool/0.1",
          },
          agent: false,
        },
        (incomingResponse) => {
          if (settled) {
            incomingResponse.destroy();
            return;
          }
          response = incomingResponse;
          if (
            [301, 302, 303, 307, 308].includes(incomingResponse.statusCode) &&
            incomingResponse.headers.location
          ) {
            incomingResponse.destroy();
            try {
              if (redirectCount >= 3)
                throw new Error("下载重定向过多，请使用最终下载地址");
              const next = downloadUrl(
                new URL(incomingResponse.headers.location, url).href,
              );
              if (url.startsWith("https:") && !next.startsWith("https:"))
                throw new Error("下载地址重定向到 HTTP，请核实后填写最终地址");
              openDownload(next, redirectCount + 1);
            } catch (error) {
              finish(error);
            }
            return;
          }
          if (incomingResponse.statusCode !== 200) {
            finish(
              new Error(`下载请求返回 HTTP ${incomingResponse.statusCode}`),
            );
            return;
          }
          if (
            incomingResponse.headers["content-encoding"] &&
            incomingResponse.headers["content-encoding"] !== "identity"
          ) {
            finish(new Error("下载服务返回压缩内容，请选择原始文件地址"));
            return;
          }
          // Body duration starts only after a valid final response. Idle timeout
          // separately covers connection setup, redirects and gaps between chunks.
          bodyStartedAt = performance.now();
          durationTimer = setTimeout(
            () => finish(null, "duration"),
            options.duration * 1000,
          );
          progressIntervalTimer = setInterval(
            () => progress(createSnapshot("running")),
            250,
          );
          incomingResponse.on("data", (chunk) => {
            bytes += chunk.length;
            resetIdleTimeout();
            if (bytes >= maxDownloadBytes) finish(null, "bytes");
          });
          incomingResponse.once("end", () =>
            finish(bytes ? null : new Error("下载内容为空"), "end"),
          );
          incomingResponse.once("error", (error) =>
            finish(new Error(`下载中断：${error.code || error.message}`)),
          );
          incomingResponse.once("aborted", () => {
            if (!settled) finish(new Error("下载响应提前中断"));
          });
        },
      );
      request = activeRequest;
      activeRequest.once("error", (error) => {
        if (request === activeRequest)
          finish(new Error(`下载失败：${error.code || error.message}`));
      });
    }
    if (signal.aborted) {
      finish(new Error("任务已停止"));
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    openDownload(options.target);
  });
}

module.exports = { downloadUrl, measureDownload };
