# BBID Self-Hosted Prototype

A cross-platform implementation of the Biometric/Behavioral Identity (BBID) protocol that can run on Mac, Windows, and Linux.

## Features

- **Cross-platform**: Runs on any system with Python 3.8+
- **Self-hosted**: Complete local deployment, no external dependencies
- **BBID Protocol**: Implements the core cryptographic operations:
  - HKDF-SHA256 key derivation
  - AES-CTR-DRBG seed expansion
  - User-specific projection hyperplane generation
  - Version rotation for re-enrollment
- **Simple Web Interface**: Easy-to-use UI for enrollment and authentication

## Architecture

```
┌─────────────────────────────────────┐
│         Web Browser (Client)        │
│  - Collects hardware/behavioral     │
│  - Sends enrollment/auth requests   │
└──────────────┬──────────────────────┘
               │ HTTP/JSON
               ▼
┌─────────────────────────────────────┐
│      Flask Server (Python)          │
│  - HKDF-SHA256 key derivation       │
│  - AES-CTR-DRBG expansion          │
│  - In-memory graph database         │
└─────────────────────────────────────┘
```

## Prerequisites

- Python 3.8 or higher
- pip (Python package manager)

## Installation

### Quick Start (Recommended)

Use the provided startup scripts which automatically detect your OS, clear port 8000, and start the server:

**Mac/Linux:**
```bash
cd /Users/ryanbarrett/Documents/New\ project/bbid-prototype
./start.sh
```

**Windows (PowerShell):**
```powershell
cd C:\path\to\bbid-prototype
.\start.ps1
```

### Manual Setup

#### Mac

```bash
# Install Python 3 (if not already installed)
brew install python3

# Navigate to the bbid-prototype directory
cd /Users/ryanbarrett/Documents/New\ project/bbid-prototype

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py
```

Open your browser to: `http://localhost:8000`

#### Windows

```cmd
# Install Python 3 from https://python.org/downloads/

# Navigate to the bbid-prototype directory
cd C:\path\to\bbid-prototype

# Create virtual environment (recommended)
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py
```

Open your browser to: `http://localhost:8000`

#### Linux

```bash
# Install Python 3 (if not already installed)
sudo apt-get update
sudo apt-get install python3 python3-pip python3-venv

# Navigate to the bbid-prototype directory
cd /path/to/bbid-prototype

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
python server.py
```

Open your browser to: `http://localhost:8000`

## Usage

### 1. Enroll a New User

- Click the **Enroll** tab
- Enter a User ID (e.g., "alice")
- Enter a Blinding Factor (δ) - XOR mask for the codeword
- Enter a Hash Anchor - Hash of the enrolled codeword
- Enter Hardware Features - Simplified browser fingerprint
- Click **Enroll User**

### 2. Authenticate

- Click the **Authenticate** tab
- Enter the User ID you enrolled
- Click **Get Derived Seed**
- The server returns a user-specific seed derived via HKDF-SHA256

### 3. Re-Enroll (Version Rotation)

- Click the **Re-Enroll** tab
- Enter the User ID
- Click **Increment Version**
- The version parameter is incremented, deriving a new projection matrix

## API Endpoints

### POST `/api/enroll`
Enroll a new user.

**Request:**
```json
{
  "user_id": "alice",
  "blinding_factor": "a1b2c3d4e5f6",
  "hash_anchor": "7f8e9d0a1b2c",
  "hw_features": "canvas:1234,webgl:5678"
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "alice",
  "version": 0
}
```

### POST `/api/auth/seed`
Get derived seed for authentication.

**Request:**
```json
{
  "user_id": "alice"
}
```

**Response:**
```json
{
  "seed": "a1b2c3d4...",
  "version": 0
}
```

### POST `/api/re-enroll`
Increment user version for re-enrollment.

**Request:**
```json
{
  "user_id": "alice"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Version incremented"
}
```

### GET `/api/users`
List all registered users (debug only).

**Response:**
```json
{
  "users": ["alice", "bob"],
  "count": 2
}
```

## Security Notes

**This is a prototype for testing purposes. For production deployment:**

1. **Replace in-memory database** with Neo4j or another graph database
2. **Secure M_sys** (Master System Secret) in a hardware-bound TEE or encrypted environment variables
3. **Add rate limiting** to prevent brute force attacks
4. **Implement proper error handling** and logging
5. **Add HTTPS/TLS** for secure communication
6. **Use production-grade random number generators** for entropy
7. **Implement proper session management** and CSRF protection

## Cryptographic Details

### Key Derivation
```
seed_u = HKDF-SHA256(M_sys, info = ID_u || s_u || v_u)
```

### Seed Expansion
```
R_u = DRBG_AES-CTR(seed_u) ∈ R^(k × d)
```

### Version Rotation
```
v_u ← v_u + 1
```

When the version is incremented, a completely new projection matrix is derived, ensuring clean revocability.

## Troubleshooting

**Port 8000 already in use:**
```bash
# On Mac/Linux
lsof -ti:8000 | xargs kill -9

# On Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

**Python not found:**
- Ensure Python 3.8+ is installed and in your PATH
- On Windows, you may need to add Python to PATH during installation

**Dependencies fail to install:**
- Ensure you have the latest pip: `pip install --upgrade pip`
- If using a virtual environment, ensure it's activated

## License

This prototype is provided for educational and testing purposes.

## References

- BBID Formal Specification: See `../BBID_Formal_Specification.md`
- BBID Paper: See `../bbid-paper.pdf`
