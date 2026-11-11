"""
Braille Codec — encode/decode arbitrary bytes as Braille Unicode.

The 256 Unicode Braille characters (U+2800 to U+28FF) map 1:1 to byte values
0x00-0xFF. Each character's Unicode codepoint offset from U+2800 IS the byte
value. This gives us a natural, lossless, bijective encoding.

Properties:
  - Bijective:     every byte sequence has exactly one Braille representation
  - Lossless:      decode(encode(x)) == x for all x
  - Fixed density:  1 byte = 1 Braille character = 3 UTF-8 bytes

Token efficiency:
  Most LLM tokenizers treat Braille characters as single tokens or small
  multi-byte sequences, making this encoding competitive with or better than
  hex/base64 for transmitting binary data through language models.

Visual examples:
  0x00 -> U+2800 (blank)    0x01 -> U+2801    0x41 ('A') -> U+2841    0xFF -> U+28FF (all dots)
"""

from __future__ import annotations

# The base codepoint for Braille patterns
BRAILLE_BASE = 0x2800

# Pre-compute lookup tables for speed
_BYTE_TO_BRAILLE: list[str] = [chr(BRAILLE_BASE + i) for i in range(256)]
_BRAILLE_TO_BYTE: dict[str, int] = {chr(BRAILLE_BASE + i): i for i in range(256)}

# 8-dot braille dot positions: dot 1-8 mapped to bit positions
# Standard: dots 1-6 in left/right columns top-to-bottom, dots 7-8 at bottom
_DOT_BITS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]


def encode(data: bytes) -> str:
    """Encode arbitrary bytes as a Braille Unicode string.

    Args:
        data: Arbitrary byte sequence.

    Returns:
        String of Braille characters, one per input byte.

    Examples:
        >>> encode(b'\\x00')
        '\\u2800'
        >>> encode(b'\\xff')
        '\\u28ff'
        >>> encode(b'hello')
        '\\u2868\\u2865\\u286c\\u286c\\u286f'
    """
    return "".join(_BYTE_TO_BRAILLE[b] for b in data)


def decode(braille: str) -> bytes:
    """Decode a Braille Unicode string back to bytes.

    Strict mode: raises ValueError on non-Braille characters.
    Use extract_braille() first if input may contain mixed content.

    Args:
        braille: String of Braille characters.

    Returns:
        Original byte sequence.

    Raises:
        ValueError: If string contains non-Braille characters.
    """
    result = bytearray(len(braille))
    for i, char in enumerate(braille):
        cp = ord(char) - BRAILLE_BASE
        if cp < 0 or cp > 255:
            raise ValueError(
                f"Character at position {i} is not a Braille pattern: "
                f"U+{ord(char):04X} ({char!r})"
            )
        result[i] = cp
    return bytes(result)


def encode_hex(hex_str: str) -> str:
    """Encode a hex string as Braille.

    Args:
        hex_str: Hex string (with or without '0x' prefix, spaces allowed).

    Returns:
        Braille-encoded string.
    """
    hex_str = hex_str.replace(" ", "").replace("0x", "").replace("0X", "")
    return encode(bytes.fromhex(hex_str))


def encode_int(n: int, width: int = 4) -> str:
    """Encode an integer as fixed-width Braille (big-endian).

    Args:
        n: Non-negative integer.
        width: Number of bytes (= number of Braille characters).

    Returns:
        Fixed-width Braille string.

    Raises:
        ValueError: If n is negative or doesn't fit in width bytes.
    """
    if n < 0:
        raise ValueError(f"Cannot encode negative integer: {n}")
    max_val = (1 << (width * 8)) - 1
    if n > max_val:
        raise ValueError(
            f"Integer {n} does not fit in {width} bytes (max {max_val})"
        )
    return encode(n.to_bytes(width, byteorder="big"))


def decode_int(braille: str) -> int:
    """Decode a Braille string back to an integer (big-endian)."""
    return int.from_bytes(decode(braille), byteorder="big")


def encode_text(text: str) -> str:
    """Encode a UTF-8 text string as Braille.

    Each UTF-8 byte becomes one Braille character. Multi-byte characters
    produce multiple Braille cells.
    """
    return encode(text.encode("utf-8"))


def decode_text(braille: str) -> str:
    """Decode a Braille string back to UTF-8 text."""
    return decode(braille).decode("utf-8")


def is_braille(char: str) -> bool:
    """Check if a single character is a Braille pattern (U+2800-U+28FF)."""
    cp = ord(char)
    return BRAILLE_BASE <= cp <= BRAILLE_BASE + 255


def extract_braille(text: str) -> str:
    """Extract only Braille characters from mixed text.

    Useful for cleaning LLM responses that mix prose with Braille output.

    Args:
        text: Mixed text potentially containing Braille characters.

    Returns:
        String containing only the Braille characters from the input.
    """
    return "".join(c for c in text if is_braille(c))


def braille_len(braille: str) -> int:
    """Return the number of bytes encoded in a Braille string.

    Same as len(braille) since the encoding is 1:1, but explicit
    about the semantic meaning.
    """
    return len(braille)


def to_hex(braille: str) -> str:
    """Convert Braille string to hex representation."""
    return decode(braille).hex()


def to_dots(char: str) -> list[bool]:
    """Convert a single Braille character to its 8-dot pattern.

    Returns a list of 8 booleans, one per dot (dots 1-8).

    Args:
        char: A single Braille character.

    Returns:
        List of 8 booleans.

    Raises:
        ValueError: If char is not a Braille pattern.
    """
    cp = ord(char) - BRAILLE_BASE
    if cp < 0 or cp > 255:
        raise ValueError(f"Not a Braille character: U+{ord(char):04X}")
    return [bool(cp & bit) for bit in _DOT_BITS]


def from_dots(dots: list[bool]) -> str:
    """Convert an 8-dot pattern to a Braille character.

    Args:
        dots: List of 8 booleans, one per dot (dots 1-8).

    Returns:
        Single Braille character.
    """
    if len(dots) != 8:
        raise ValueError(f"Expected 8 dots, got {len(dots)}")
    byte = sum(bit for bit, active in zip(_DOT_BITS, dots) if active)
    return chr(BRAILLE_BASE + byte)
