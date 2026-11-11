#!/usr/bin/env python3
"""
BBID Self-Hosted Prototype Server
Cross-platform implementation of the BBID protocol
"""

import os
import secrets
import json
import hashlib
from datetime import datetime
from typing import Dict, Optional, Tuple
from flask import Flask, request, jsonify, render_template
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

app = Flask(__name__)

# Master System Secret (M_sys) - in production, store securely in env vars or TEE
M_SYS = os.environ.get('BBID_MASTER_SECRET', secrets.token_bytes(32))

# In-memory graph database (prototype only - replace with Neo4j in production)
user_nodes: Dict[str, dict] = {}

class BBIDServer:
    """BBID protocol implementation"""
    
    def __init__(self, master_secret: bytes):
        self.master_secret = master_secret
        self.backend = default_backend()
    
    def derive_user_seed(self, user_id: str, salt: bytes, version: int) -> bytes:
        """
        Derive user-specific seed using HKDF-SHA256
        seed_u = HKDF-SHA256(M_sys, info = ID_u || s_u || v_u)
        """
        info = f"{user_id}|{salt.hex()}|{version}".encode('utf-8')
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=info,
            backend=self.backend
        )
        return hkdf.derive(self.master_secret)
    
    def expand_seed_to_hyperplanes(self, seed: bytes, k: int, d: int) -> list:
        """
        Expand seed to random hyperplanes using AES-CTR-DRBG
        R_u = DRBG_AES-CTR(seed_u) ∈ R^(k × d)
        """
        # Simplified: use AES-CTR to generate pseudorandom bytes
        # Convert to float hyperplanes in [-1, 1]
        cipher = Cipher(algorithms.AES(seed), modes.CTR(bytes(16)), backend=self.backend)
        encryptor = cipher.encryptor()
        
        # Generate enough bytes for k × d floats
        num_floats = k * d
        bytes_needed = num_floats * 4
        pseudo_random = encryptor.update(bytes_needed) + encryptor.finalize()
        
        # Convert bytes to floats in [-1, 1]
        hyperplanes = []
        for i in range(num_floats):
            # Take 4 bytes, interpret as int, normalize to [-1, 1]
            val = int.from_bytes(pseudo_random[i*4:(i+1)*4], 'big')
            normalized = (val / 2**32) * 2 - 1
            hyperplanes.append(normalized)
        
        return hyperplanes
    
    def register_user(self, user_id: str, hw_features: str, behavioral_features: str = "") -> dict:
        """Register a new user node - generates blinding factor and hash anchor automatically"""
        if user_id in user_nodes:
            return {"error": "User already exists"}

        salt = secrets.token_bytes(16)
        version = 0
        timestamp = datetime.utcnow().isoformat()

        # Generate blinding factor and hash anchor automatically
        blinding_factor = secrets.token_hex(16)
        hash_anchor = secrets.token_hex(16)

        user_nodes[user_id] = {
            "user_id": user_id,
            "salt": salt.hex(),
            "version": version,
            "blinding_factor": blinding_factor,
            "hash_anchor": hash_anchor,
            "hw_features": hw_features,
            "behavioral_features": behavioral_features,
            "created_at": timestamp,
            "updated_at": timestamp
        }

        return {"success": True, "user_id": user_id, "version": version}
    
    def get_user_seed(self, user_id: str) -> Optional[Tuple[bytes, int]]:
        """Get derived seed for a user"""
        if user_id not in user_nodes:
            return None
        
        user = user_nodes[user_id]
        salt = bytes.fromhex(user["salt"])
        version = user["version"]
        
        seed = self.derive_user_seed(user_id, salt, version)
        return seed, version
    
    def increment_version(self, user_id: str) -> bool:
        """Increment user version for re-enrollment"""
        if user_id not in user_nodes:
            return False
        
        user_nodes[user_id]["version"] += 1
        user_nodes[user_id]["updated_at"] = datetime.utcnow().isoformat()
        return True
    
    def calculate_feature_distance(self, features1: str, features2: str) -> float:
        """
        Calculate normalized distance between two feature strings.
        Simplified: use hash difference as proxy for feature distance.
        In production, use actual feature vectors and Euclidean/cosine distance.
        """
        if not features1 or not features2:
            return 1.0  # Maximum distance if one is missing
        
        # Create hash of each feature string
        hash1 = hashlib.sha256(features1.encode()).digest()
        hash2 = hashlib.sha256(features2.encode()).digest()
        
        # Calculate Hamming distance between hashes
        xor_bytes = bytes(a ^ b for a, b in zip(hash1, hash2))
        bit_diff = sum(bin(byte).count('1') for byte in xor_bytes)
        total_bits = 256  # SHA256 output
        
        # Normalize to [0, 1]
        distance = bit_diff / total_bits
        return distance
    
    def authenticate_with_mismatch_detection(self, user_id: str, 
                                              current_hw_features: str,
                                              current_behavioral_features: str,
                                              hw_threshold: float = 0.3,
                                              behavioral_threshold: float = 0.4) -> dict:
        """
        Authenticate user with explicit mismatch detection.
        Returns detailed information about which subspace caused the mismatch.
        """
        if user_id not in user_nodes:
            return {
                "authenticated": False,
                "error": "User not found"
            }
        
        user = user_nodes[user_id]
        enrolled_hw = user["hw_features"]
        enrolled_behavioral = user.get("behavioral_features", "")
        
        # Calculate distances for each subspace
        hw_distance = self.calculate_feature_distance(current_hw_features, enrolled_hw)
        behavioral_distance = self.calculate_feature_distance(current_behavioral_features, enrolled_behavioral)
        
        # Determine which subspaces match
        hw_match = hw_distance <= hw_threshold
        behavioral_match = behavioral_distance <= behavioral_threshold
        
        # Overall authentication
        authenticated = hw_match and behavioral_match
        
        # Determine mismatch type
        mismatch_type = None
        if not authenticated:
            if not hw_match and not behavioral_match:
                mismatch_type = "both"
            elif not hw_match:
                mismatch_type = "hardware_only"
            elif not behavioral_match:
                mismatch_type = "behavioral_only"
        
        return {
            "authenticated": authenticated,
            "mismatch_type": mismatch_type,
            "hw_distance": round(hw_distance, 4),
            "behavioral_distance": round(behavioral_distance, 4),
            "hw_threshold": hw_threshold,
            "behavioral_threshold": behavioral_threshold,
            "hw_match": hw_match,
            "behavioral_match": behavioral_match,
            "confidence": round(1 - max(hw_distance, behavioral_distance), 4)
        }

# Initialize BBID server
bbid = BBIDServer(M_SYS)

@app.route('/')
def index():
    """Serve the web interface"""
    return render_template('index.html')

@app.route('/api/enroll', methods=['POST'])
def enroll():
    """Enroll a new user - generates blinding factor and hash anchor automatically"""
    data = request.json
    user_id = data.get('user_id')
    hw_features = data.get('hw_features')
    behavioral_features = data.get('behavioral_features', '')

    if not all([user_id, hw_features]):
        return jsonify({"error": "Missing required fields"}), 400

    result = bbid.register_user(user_id, hw_features, behavioral_features)
    return jsonify(result)

@app.route('/api/auth/seed', methods=['POST'])
def get_seed():
    """Get derived seed for authentication"""
    data = request.json
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 400
    
    result = bbid.get_user_seed(user_id)
    if result is None:
        return jsonify({"error": "User not found"}), 404
    
    seed, version = result
    return jsonify({
        "seed": seed.hex(),
        "version": version
    })

@app.route('/api/auth/verify', methods=['POST'])
def verify_with_mismatch():
    """Authenticate with explicit mismatch detection"""
    data = request.json
    user_id = data.get('user_id')
    current_hw_features = data.get('hw_features', '')
    current_behavioral_features = data.get('behavioral_features', '')
    hw_threshold = data.get('hw_threshold', 0.3)
    behavioral_threshold = data.get('behavioral_threshold', 0.4)
    
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 400
    
    result = bbid.authenticate_with_mismatch_detection(
        user_id,
        current_hw_features,
        current_behavioral_features,
        hw_threshold,
        behavioral_threshold
    )
    
    return jsonify(result)

@app.route('/api/re-enroll', methods=['POST'])
def re_enroll():
    """Trigger re-enrollment (increment version)"""
    data = request.json
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 400
    
    success = bbid.increment_version(user_id)
    if not success:
        return jsonify({"error": "User not found"}), 404
    
    return jsonify({"success": True, "message": "Version incremented"})

@app.route('/api/users', methods=['GET'])
def list_users():
    """List all registered users (debug only)"""
    return jsonify({
        "users": list(user_nodes.keys()),
        "count": len(user_nodes)
    })

if __name__ == '__main__':
    print("BBID Prototype Server")
    print(f"Master Secret: {M_SYS.hex()[:16]}...")
    print("Open http://localhost:8000 in your browser")
    app.run(host='0.0.0.0', port=8000, debug=True)
