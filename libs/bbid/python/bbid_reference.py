"""
sal-auth BBID (BrailleBuddy Identity) Module

BBID is a braille-encoded identity system that works across all SAL services.
Each user has a unique 8-dot braille identity that can be:
- Displayed visually as braille characters
- Rendered as haptic patterns
- Spoken as audio
- Used for cryptographic signing
"""

import hashlib
import hmac
import secrets
from typing import Optional, Tuple
from datetime import datetime
from dataclasses import dataclass

from config import settings


# 8-dot braille range
BRAILLE_BASE = 0x2800


@dataclass
class BBID:
    """BrailleBuddy Identity"""
    braille: str           # 8-dot braille representation
    user_id: str           # UUID
    created_at: datetime
    signature: str         # Cryptographic signature
    
    @property
    def display(self) -> str:
        """Human-readable display"""
        return f"{settings.bbid_prefix}{self.braille}"
    
    @property
    def haptic_pattern(self) -> list:
        """Generate haptic pattern for BBID"""
        patterns = []
        for char in self.braille:
            code = ord(char) - BRAILLE_BASE
            dot_count = bin(code).count('1')
            patterns.append({
                "duration": 50 + (dot_count * 20),
                "intensity": 0.3 + (dot_count * 0.1)
            })
            patterns.append({"type": "pause", "duration": 100})
        return patterns


class BBIDGenerator:
    """Generates and verifies BBIDs"""
    
    def __init__(self, encryption_key: str = None):
        self.key = (encryption_key or settings.bbid_encryption_key).encode()
        
    def generate(self, user_id: str, username: str) -> BBID:
        """Generate a new BBID for a user"""
        # Create deterministic but unique braille identity
        seed = f"{user_id}:{username}:{secrets.token_hex(8)}"
        hash_bytes = hashlib.sha256(seed.encode()).digest()
        
        # Convert to 8-dot braille (8 characters = 64 bits of entropy)
        braille_chars = []
        for i in range(8):
            byte_val = hash_bytes[i]
            braille_char = chr(BRAILLE_BASE + byte_val)
            braille_chars.append(braille_char)
            
        braille = ''.join(braille_chars)
        
        # Create signature
        signature = self._sign(braille, user_id)
        
        return BBID(
            braille=braille,
            user_id=user_id,
            created_at=datetime.utcnow(),
            signature=signature
        )
        
    def verify(self, bbid: BBID) -> bool:
        """Verify BBID signature"""
        expected_sig = self._sign(bbid.braille, bbid.user_id)
        return hmac.compare_digest(bbid.signature, expected_sig)
        
    def _sign(self, braille: str, user_id: str) -> str:
        """Create HMAC signature"""
        message = f"{braille}:{user_id}".encode()
        sig = hmac.new(self.key, message, hashlib.sha256).hexdigest()
        # Encode signature as braille too (first 8 chars)
        sig_braille = ''.join(
            chr(BRAILLE_BASE + int(sig[i:i+2], 16))
            for i in range(0, 16, 2)
        )
        return sig_braille
        
    def encode_text_to_bbid_style(self, text: str) -> str:
        """Encode arbitrary text in BBID-style 8-dot braille"""
        result = []
        for char in text.lower():
            code = ord(char) % 256
            result.append(chr(BRAILLE_BASE + code))
        return ''.join(result)
        
    def decode_bbid_to_text(self, braille: str) -> str:
        """Decode BBID-style braille back to text (lossy)"""
        result = []
        for char in braille:
            code = ord(char) - BRAILLE_BASE
            if 97 <= code <= 122:  # a-z
                result.append(chr(code))
            elif 65 <= code <= 90:  # A-Z
                result.append(chr(code))
            elif 48 <= code <= 57:  # 0-9
                result.append(chr(code))
            elif code == 32:  # space
                result.append(' ')
            else:
                result.append('?')
        return ''.join(result)


class BBIDTokenEncoder:
    """Encodes BBID information into JWT tokens"""
    
    def __init__(self):
        self.generator = BBIDGenerator()
        
    def create_token_claims(self, user_id: str, bbid: BBID) -> dict:
        """Create BBID-enhanced token claims"""
        return {
            "bbid": bbid.display,
            "bbid_raw": bbid.braille,
            "bbid_sig": bbid.signature,
            "bbid_created": bbid.created_at.isoformat(),
            "modalities": ["voice", "text", "braille", "haptic"]
        }
        
    def verify_token_bbid(self, claims: dict, expected_user_id: str) -> bool:
        """Verify BBID claims in token"""
        try:
            bbid = BBID(
                braille=claims.get("bbid_raw", ""),
                user_id=expected_user_id,
                created_at=datetime.fromisoformat(claims.get("bbid_created", "")),
                signature=claims.get("bbid_sig", "")
            )
            return self.generator.verify(bbid)
        except Exception:
            return False


# Global instances
bbid_generator = BBIDGenerator()
bbid_token_encoder = BBIDTokenEncoder()
