'use strict';

/**
 * Zero-Dependency RFC 6455 WebSocket Client (`scripts/lib/rfc6455-ws.js`).
 *
 * Supports:
 * - Masked client text (`0x81`), pong (`0x8a`), and close (`0x88`) frames
 * - Fragmented server frames (`FIN=0` + continuation `0x00`) reassembly
 * - Automatic Ping (`0x89`) -> Pong (`0x8a`) payload echo
 * - Graceful Close (`0x08`) frame flush prior to TCP close
 * - 16 MiB inbound buffer ceiling (`MAX_WS_BUFFER_BYTES`)
 */

const net = require('net');
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_BUFFER_BYTES = 16 * 1024 * 1024;

function buildMaskedFrame(opcode, payloadBuf) {
  const mask = crypto.randomBytes(4);
  const len = payloadBuf.length;
  let headerLen = 2;
  if (len >= 126 && len <= 65535) headerLen = 4;
  else if (len > 65535) headerLen = 10;

  const frame = Buffer.alloc(headerLen + 4 + len);
  frame[0] = 0x80 | (opcode & 0x0f);

  let maskOffset = 2;
  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len <= 65535) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
    maskOffset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    maskOffset = 10;
  }

  mask.copy(frame, maskOffset);
  const dataOffset = maskOffset + 4;
  for (let i = 0; i < len; i += 1) {
    frame[dataOffset + i] = payloadBuf[i] ^ mask[i & 3];
  }
  return frame;
}

/**
 * Opens an RFC 6455 WebSocket client connection to `wsUrl` (`ws://127.0.0.1:...`).
 *
 * @param {string} wsUrl
 * @param {{ maxBufferBytes?: number }} [options]
 */
function createRfc6455WebSocketClient(wsUrl, options = {}) {
  const maxBufferBytes = options.maxBufferBytes || MAX_WS_BUFFER_BYTES;
  const parsed = new URL(wsUrl);
  if (parsed.protocol !== 'ws:') {
    throw new Error(`Unsupported WebSocket protocol: ${parsed.protocol}`);
  }

  const port = Number(parsed.port || 80);
  const host = parsed.hostname || '127.0.0.1';
  const reqPath = `${parsed.pathname || '/'}${parsed.search || ''}`;

  const secKey = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1').update(secKey + WS_GUID).digest('base64');

  let sock = null;
  let handshakeDone = false;
  let closed = false;
  let closeNotified = false;
  let rxBuffer = Buffer.alloc(0);
  let fragmentOpcode = 0;
  let fragmentChunks = [];
  let fragmentTotalBytes = 0;

  const client = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      if (closed || !sock || !handshakeDone) {
        throw new Error('WebSocket is not open');
      }
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      sock.write(buildMaskedFrame(0x01, payload));
    },
    close(code = 1000) {
      if (closed) return;
      closed = true;
      if (sock && !sock.destroyed && handshakeDone) {
        const closePayload = Buffer.alloc(2);
        closePayload.writeUInt16BE(code, 0);
        try {
          sock.end(buildMaskedFrame(0x08, closePayload));
        } catch {
          sock.destroy();
        }
      } else if (sock && !sock.destroyed) {
        sock.destroy();
      }
      notifyClose(code, '');
    },
  };

  const notifyError = (err) => {
    if (typeof client.onerror === 'function') {
      client.onerror(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const notifyClose = (code, reason) => {
    if (closeNotified) return;
    closeNotified = true;
    if (typeof client.onclose === 'function') {
      client.onclose({ code, reason });
    }
  };

  const parseFrames = () => {
    while (rxBuffer.length >= 2 && !closed) {
      const b0 = rxBuffer[0];
      const b1 = rxBuffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (rxBuffer.length < 4) return;
        payloadLen = rxBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (rxBuffer.length < 10) return;
        const bigLen = rxBuffer.readBigUInt64BE(2);
        if (bigLen > BigInt(maxBufferBytes)) {
          notifyError(new Error('WebSocket frame exceeds maximum buffer size'));
          client.close(1009);
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      const maskBytes = masked ? 4 : 0;
      const totalFrameLen = offset + maskBytes + payloadLen;
      if (totalFrameLen > maxBufferBytes) {
        notifyError(new Error('WebSocket frame exceeds maximum buffer size'));
        client.close(1009);
        return;
      }
      if (rxBuffer.length < totalFrameLen) return;

      let payload = Buffer.from(rxBuffer.subarray(offset + maskBytes, totalFrameLen));
      if (masked) {
        const maskKey = rxBuffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= maskKey[i & 3];
        }
      }
      rxBuffer = rxBuffer.subarray(totalFrameLen);

      if (opcode === 0x09) {
        // Ping -> echo Pong with identical payload
        if (sock && !sock.destroyed) {
          sock.write(buildMaskedFrame(0x0a, payload));
        }
        continue;
      }
      if (opcode === 0x0a) {
        // Pong
        continue;
      }
      if (opcode === 0x08) {
        // Server Close -> echo Close and end socket
        const closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const closeReason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        if (!closed && sock && !sock.destroyed) {
          closed = true;
          const replyPayload = Buffer.alloc(2);
          replyPayload.writeUInt16BE(closeCode, 0);
          try {
            sock.end(buildMaskedFrame(0x08, replyPayload));
          } catch {
            sock.destroy();
          }
        }
        notifyClose(closeCode, closeReason);
        return;
      }

      if (opcode === 0x01 || opcode === 0x02) {
        if (fin) {
          const text = payload.toString('utf8');
          if (typeof client.onmessage === 'function') {
            client.onmessage({ data: text });
          }
        } else {
          fragmentOpcode = opcode;
          fragmentChunks = [payload];
          fragmentTotalBytes = payload.length;
        }
      } else if (opcode === 0x00 && fragmentOpcode !== 0) {
        fragmentTotalBytes += payload.length;
        if (fragmentTotalBytes > maxBufferBytes) {
          notifyError(new Error('Fragmented WebSocket message exceeds maximum buffer size'));
          client.close(1009);
          return;
        }
        fragmentChunks.push(payload);
        if (fin) {
          const fullPayload = Buffer.concat(fragmentChunks);
          fragmentOpcode = 0;
          fragmentChunks = [];
          fragmentTotalBytes = 0;
          if (typeof client.onmessage === 'function') {
            client.onmessage({ data: fullPayload.toString('utf8') });
          }
        }
      }
    }
  };

  sock = net.connect({ host, port }, () => {
    const reqLines = [
      `GET ${reqPath} HTTP/1.1`,
      `Host: ${host}:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${secKey}`,
      'Sec-WebSocket-Version: 13',
      '\r\n',
    ];
    sock.write(reqLines.join('\r\n'));
  });

  sock.on('data', (chunk) => {
    if (closed) return;
    if (rxBuffer.length + chunk.length > maxBufferBytes) {
      notifyError(new Error('WebSocket receive buffer limit exceeded'));
      client.close(1009);
      return;
    }
    rxBuffer = rxBuffer.length === 0 ? chunk : Buffer.concat([rxBuffer, chunk]);

    if (!handshakeDone) {
      const headerEnd = rxBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const headerStr = rxBuffer.subarray(0, headerEnd).toString('utf8');
      rxBuffer = rxBuffer.subarray(headerEnd + 4);

      const lines = headerStr.split('\r\n');
      const statusLine = lines[0] || '';
      if (!/^HTTP\/1\.1\s+101\b/i.test(statusLine)) {
        notifyError(new Error(`WebSocket upgrade failed: ${statusLine}`));
        client.close(1002);
        return;
      }
      let acceptHeader = '';
      for (let i = 1; i < lines.length; i += 1) {
        const m = lines[i].match(/^Sec-WebSocket-Accept:\s*(.+)$/i);
        if (m) {
          acceptHeader = m[1].trim();
          break;
        }
      }
      if (acceptHeader !== expectedAccept) {
        notifyError(new Error('Invalid Sec-WebSocket-Accept header'));
        client.close(1002);
        return;
      }

      handshakeDone = true;
      if (typeof client.onopen === 'function') {
        client.onopen();
      }
    }

    if (handshakeDone && rxBuffer.length > 0) {
      parseFrames();
    }
  });

  sock.on('error', (err) => {
    notifyError(err);
    closed = true;
    notifyClose(1006, err?.message || '');
  });

  sock.on('close', () => {
    closed = true;
    notifyClose(1000, '');
  });

  return client;
}

module.exports = {
  MAX_WS_BUFFER_BYTES,
  buildMaskedFrame,
  createRfc6455WebSocketClient,
};
