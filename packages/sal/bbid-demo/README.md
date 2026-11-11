# BBID Demo - Biometric/Behavioral Identity Detection System

A simplified demonstration of the Biometric/Behavioral Identity (BBID) protocol that can identify users across devices without requiring login credentials.

## What This Demo Does

This demo implements a simplified version of the BBID protocol described in the formal specification. It:

1. **Collects Device Fingerprinting**: Canvas rendering, WebGL parameters, screen geometry, platform information
2. **Tracks Behavioral Patterns**: Keystroke dynamics, mouse movement velocity and acceleration, scroll patterns, touch gestures
3. **Generates Identity Tokens**: Uses random projection (SimHash) and fuzzy commitment to create stable identity signatures
4. **Visualizes Identity**: Displays your unique BBID signature as Unicode Braille characters
5. **Cross-Device Detection**: Can recognize you across different devices based on your unique combination of hardware and behavioral patterns

## How to Use

### Step 1: Start the Demo

Open `index.html` in a web browser. For best results, use a local server:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (if you have http-server installed)
npx http-server -p 8000

# Using PHP
php -S localhost:8000
```

Then navigate to `http://localhost:8000`

### Step 2: Enroll Your Identity

1. Click the **"Enroll Identity"** button
2. Type naturally in the text area (at least 20-30 characters recommended)
3. Move your mouse around the page
4. The system will collect your device fingerprint and behavioral patterns
5. Your unique BBID signature will be displayed as Braille characters (e.g., ⣾⣄⠹⢟⣓⠆⡧⣠)

### Step 3: Test Cross-Device Recognition

1. On your first device (e.g., Mac laptop), complete enrollment
2. Open the same demo on another device (e.g., Samsung Galaxy S25+, Windows Surface Pro 8)
3. Type naturally and move the mouse/touch
4. Click **"Authenticate"** to see if the system recognizes you

**Note**: This is a simplified demo. True cross-device recognition requires:
- More sophisticated behavioral modeling
- Larger datasets for training
- The full production architecture with Neo4j, Cloudflare Workers, and Wasm

## What Makes This Unique

Unlike traditional authentication systems that rely on:
- Passwords (something you know)
- Physical tokens (something you have)
- Static biometrics (something you are - fingerprint, face)

BBID uses:
- **Dynamic behavioral patterns**: How you type, move your mouse, interact with devices
- **Device fingerprinting**: Unique hardware characteristics
- **Noise-resilient algorithms**: Tolerates natural variations in behavior
- **Zero-storage**: No passwords or sensitive data stored in databases

## Technical Implementation

This demo includes:

### Device Fingerprinting
- Canvas rendering fingerprint
- WebGL vendor/renderer detection
- Screen resolution and color depth
- Platform information (OS, browser, hardware)
- Timezone and language settings
- Touch support detection

### Behavioral Data Collection
- **Keystroke dynamics**: Flight time between keystrokes, typing rhythm
- **Mouse dynamics**: Velocity, acceleration, movement patterns
- **Scroll dynamics**: Scroll velocity and patterns
- **Touch dynamics**: Touch gesture patterns (mobile devices)

### BBID Pipeline (Simplified)
1. **Feature Vector Construction**: Combines hardware (H) and behavioral (B) subspaces
2. **Random Projection**: Uses SimHash to project high-dimensional vectors to 64-bit space
3. **Fuzzy Commitment**: Error-tolerant binding of biometric data to canonical codeword
4. **Braille Mapping**: Converts 64-bit codeword to 8 Braille characters for visualization

### Security Features
- No raw biometric data stored (only hashed/blinded values)
- Ephemeral client-side material (projection matrix zeroized after use)
- Cancelable templates (can re-enroll to generate new identity)
- Privacy-preserving (original biometrics cannot be reconstructed)

## Limitations of This Demo

This is a **proof-of-concept demonstration** with simplifications:

1. **Simplified Projection**: Uses basic PRNG instead of cryptographically secure AES-CTR-DRBG
2. **No Server Backend**: Uses localStorage instead of Neo4j database
3. **No Key Derivation**: Skips Cloudflare Worker HKDF derivation
4. **Basic Error Correction**: Simple bit-error counting instead of BCH codes
5. **Limited Behavioral Model**: Basic statistics instead of deep learning models
6. **Browser Zeroization**: Best-effort memory clearing (browsers may copy buffers)

## Production Architecture

The full production system would include:

1. **Neo4j Database**: Store blinding factors, salts, version parameters, hash anchors
2. **Cloudflare Worker**: HKDF-based key derivation with hardware-backed master secret
3. **Wasm Module**: Cryptographically secure AES-CTR-DRBG projection with proper zeroization
4. **Advanced Error Correction**: BCH codes or Neural LDPC decoders
5. **Deep Learning Models**: For sophisticated behavioral pattern recognition

See the formal specification (`BBID_Formal_Specification.md`) for complete details.

## Testing Cross-Device Detection

To test the full potential:

1. **Enroll on multiple devices**: Complete enrollment on each device you own
2. **Compare signatures**: Note how your Braille signature varies by device
3. **Behavioral consistency**: Try to maintain similar typing/mouse patterns across devices
4. **Environmental factors**: Test at different times of day, in different locations

The system is designed to:
- Recognize you across devices (same person, different hardware)
- Distinguish between different users (different people, same device)
- Adapt to natural behavioral variations over time

## Privacy Considerations

This demo:
- Stores all data locally in your browser (localStorage)
- Does not transmit any data to external servers
- Uses only non-sensitive device characteristics
- Does not collect or store raw biometric templates

## Browser Compatibility

Tested on:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers (iOS Safari, Chrome Mobile)

Requires:
- JavaScript enabled
- Canvas support
- WebGL support (optional but recommended)
- LocalStorage support

## Troubleshooting

**"Not enough behavioral data" error**
- Type more characters in the text area (minimum 10-20 characters)
- Move your mouse around the page
- Try typing naturally rather than single characters

**"No enrolled identity found" error**
- Click "Enroll Identity" first before attempting authentication
- Ensure you have typed enough text during enrollment

**Braille signature not displaying**
- Ensure your browser supports Unicode Braille Patterns (U+2800-U+28FF)
- Most modern browsers support this

**Cross-device recognition not working**
- This is expected in the simplified demo
- True cross-device recognition requires the full production architecture
- Behavioral patterns naturally vary between devices

## Future Enhancements

To make this a production-ready system:

1. Implement full Neo4j backend with visitor node schema
2. Add Cloudflare Worker with HKDF-SHA256 key derivation
3. Build Wasm module with cryptographically secure DRBG
4. Integrate BCH error correction codes
5. Add deep learning models for behavioral analysis
6. Implement proper zeroization with secure memory handling
7. Add multi-factor authentication options
8. Implement version-based template rotation
9. Add audit logging and compliance features
10. Mobile app integration for richer behavioral data

## License

This is a demonstration of the BBID protocol for educational and research purposes.

## Contact

For questions about the BBID protocol or implementation details, refer to the formal specification document.
