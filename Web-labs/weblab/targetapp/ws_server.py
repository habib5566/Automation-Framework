"""A minimal RFC 6455 WebSocket implementation (stdlib only).

Just enough of the protocol to demo OS command injection over a WebSocket:
the server-side handshake accept-key, and text-frame decode/encode (client
frames are masked, server frames are not). No third-party websockets library.
"""
from __future__ import annotations

import base64
import hashlib
import struct

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OPCODE_TEXT = 0x1
OPCODE_CLOSE = 0x8


def accept_key(sec_websocket_key: str) -> str:
    """Compute Sec-WebSocket-Accept from the client's Sec-WebSocket-Key."""
    digest = hashlib.sha1((sec_websocket_key + WS_GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def encode_text_frame(message: str) -> bytes:
    """Encode an unmasked server text frame."""
    payload = message.encode("utf-8")
    header = bytearray([0x80 | OPCODE_TEXT])  # FIN + text opcode
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < (1 << 16):
        header.append(126)
        header += struct.pack(">H", length)
    else:
        header.append(127)
        header += struct.pack(">Q", length)
    return bytes(header) + payload


def encode_masked_text_frame(message: str, mask: bytes) -> bytes:
    """Encode a masked client text frame (the client MUST mask per RFC 6455)."""
    payload = message.encode("utf-8")
    header = bytearray([0x80 | OPCODE_TEXT])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < (1 << 16):
        header.append(0x80 | 126)
        header += struct.pack(">H", length)
    else:
        header.append(0x80 | 127)
        header += struct.pack(">Q", length)
    header += mask
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return bytes(header) + masked


def read_frame(rfile) -> "tuple[int, bytes] | None":
    """Read one frame from ``rfile``; return (opcode, payload) or None on close."""
    first2 = rfile.read(2)
    if len(first2) < 2:
        return None
    b0, b1 = first2[0], first2[1]
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length = b1 & 0x7F
    if length == 126:
        length = struct.unpack(">H", rfile.read(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", rfile.read(8))[0]
    mask = rfile.read(4) if masked else b""
    data = rfile.read(length)
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    if opcode == OPCODE_CLOSE:
        return None
    return opcode, data
