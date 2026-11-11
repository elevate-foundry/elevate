// BBID Core - Biometric/Behavioral Identity Detection System
// Simplified demo implementation

class BBIDCore {
    constructor() {
        this.deviceFingerprint = null;
        this.behavioralData = {
            keystrokes: [],
            mouseMovements: [],
            scrollEvents: [],
            touchEvents: []
        };
        this.projectionMatrix = null;
        this.seed = null;
        this.canonicalCodeword = null;
        this.blindingFactor = null;
    }

    // Device Fingerprinting
    async collectDeviceFingerprint() {
        const fingerprint = {
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                availWidth: window.screen.availWidth,
                availHeight: window.screen.availHeight,
                colorDepth: window.screen.colorDepth,
                pixelDepth: window.screen.pixelDepth
            },
            canvas: await this.getCanvasFingerprint(),
            webgl: this.getWebGLFingerprint(),
            platform: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                languages: navigator.languages,
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: navigator.deviceMemory,
                maxTouchPoints: navigator.maxTouchPoints,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            features: {
                touchSupport: 'ontouchstart' in window,
                webGL: this.hasWebGL(),
                webGL2: this.hasWebGL2(),
                webAssembly: typeof WebAssembly !== 'undefined'
            }
        };

        this.deviceFingerprint = fingerprint;
        return fingerprint;
    }

    async getCanvasFingerprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 200;
        canvas.height = 50;

        // Draw text
        ctx.fillStyle = '#f60';
        ctx.fillRect(100, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.font = '14px Arial';
        ctx.fillText('BBID Fingerprint 🔐', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('Device Detection', 4, 35);

        // Add some geometric shapes
        ctx.beginPath();
        ctx.arc(150, 25, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#ff0000';
        ctx.fill();

        ctx.beginPath();
        ctx.rect(170, 15, 20, 20);
        ctx.fillStyle = '#00ff00';
        ctx.fill();

        const dataURL = canvas.toDataURL();
        const hash = await this.simpleHash(dataURL);
        
        return {
            dataURL: dataURL.substring(0, 100) + '...',
            hash: hash
        };
    }

    getWebGLFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) {
                return { supported: false };
            }

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            
            return {
                supported: true,
                vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
                renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                version: gl.getParameter(gl.VERSION),
                shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
                maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS)
            };
        } catch (e) {
            return { supported: false, error: e.message };
        }
    }

    hasWebGL() {
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        } catch (e) {
            return false;
        }
    }

    hasWebGL2() {
        try {
            const canvas = document.createElement('canvas');
            return !!canvas.getContext('webgl2');
        } catch (e) {
            return false;
        }
    }

    // Behavioral Data Collection
    recordKeystroke(timestamp, key) {
        if (this.behavioralData.keystrokes.length > 0) {
            const lastKeystroke = this.behavioralData.keystrokes[this.behavioralData.keystrokes.length - 1];
            const interval = timestamp - lastKeystroke.timestamp;
            this.behavioralData.keystrokes.push({
                timestamp,
                key,
                interval,
                flightTime: interval
            });
        } else {
            this.behavioralData.keystrokes.push({
                timestamp,
                key,
                interval: 0,
                flightTime: 0
            });
        }
    }

    recordMouseMove(timestamp, x, y) {
        if (this.behavioralData.mouseMovements.length > 0) {
            const lastMovement = this.behavioralData.mouseMovements[this.behavioralData.mouseMovements.length - 1];
            const dx = x - lastMovement.x;
            const dy = y - lastMovement.y;
            const dt = timestamp - lastMovement.timestamp;
            const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
            const acceleration = velocity - lastMovement.velocity;

            this.behavioralData.mouseMovements.push({
                timestamp,
                x,
                y,
                dx,
                dy,
                dt,
                velocity,
                acceleration
            });
        } else {
            this.behavioralData.mouseMovements.push({
                timestamp,
                x,
                y,
                dx: 0,
                dy: 0,
                dt: 0,
                velocity: 0,
                acceleration: 0
            });
        }
    }

    recordScroll(timestamp, deltaY) {
        this.behavioralData.scrollEvents.push({
            timestamp,
            deltaY,
            velocity: Math.abs(deltaY)
        });
    }

    recordTouch(timestamp, x, y, type) {
        this.behavioralData.touchEvents.push({
            timestamp,
            x,
            y,
            type
        });
    }

    // Feature Vector Construction
    constructFeatureVector() {
        if (!this.deviceFingerprint) {
            throw new Error('Device fingerprint not collected');
        }

        // Deterministic hardware subspace (H)
        const H = this.constructHardwareVector();
        
        // Stochastic behavioral subspace (B)
        const B = this.constructBehavioralVector();

        // Composite feature vector X = [H; B]
        const X = [...H, ...B];

        return X;
    }

    constructHardwareVector() {
        const fp = this.deviceFingerprint;
        const vector = [];

        // Screen metrics
        vector.push(fp.screen.width / 4000);
        vector.push(fp.screen.height / 4000);
        vector.push(fp.screen.colorDepth / 64);
        vector.push(fp.screen.pixelDepth / 64);

        // Canvas hash (convert to numeric)
        vector.push(parseInt(fp.canvas.hash.substring(0, 8), 16) / 0xFFFFFFFF);

        // WebGL metrics
        if (fp.webgl.supported) {
            vector.push(fp.webgl.maxTextureSize / 16384);
            vector.push(fp.webgl.maxVertexAttribs / 16);
        } else {
            vector.push(0);
            vector.push(0);
        }

        // Platform metrics
        vector.push(fp.platform.hardwareConcurrency / 16);
        vector.push(fp.platform.maxTouchPoints / 10);
        vector.push(fp.features.touchSupport ? 1 : 0);
        vector.push(fp.features.webGL ? 1 : 0);
        vector.push(fp.features.webAssembly ? 1 : 0);

        return vector;
    }

    constructBehavioralVector() {
        const vector = [];

        // Keystroke dynamics
        if (this.behavioralData.keystrokes.length > 1) {
            const intervals = this.behavioralData.keystrokes
                .filter(k => k.interval > 0)
                .map(k => k.interval);
            
            const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const variance = intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length;
            const std = Math.sqrt(variance);

            vector.push(mean / 1000);  // Normalize
            vector.push(std / 1000);
            vector.push(this.calculateTypingRhythm());
        } else {
            vector.push(0, 0, 0);
        }

        // Mouse dynamics
        if (this.behavioralData.mouseMovements.length > 1) {
            const velocities = this.behavioralData.mouseMovements
                .filter(m => m.velocity > 0)
                .map(m => m.velocity);
            
            const meanVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
            const accelVariance = this.behavioralData.mouseMovements
                .map(m => m.acceleration)
                .reduce((sum, val) => sum + Math.pow(val - 0, 2), 0) / this.behavioralData.mouseMovements.length;

            vector.push(meanVelocity / 1000);
            vector.push(accelVariance / 10000);
        } else {
            vector.push(0, 0);
        }

        // Scroll dynamics
        if (this.behavioralData.scrollEvents.length > 0) {
            const scrollVelocities = this.behavioralData.scrollEvents.map(s => s.velocity);
            const meanScroll = scrollVelocities.reduce((a, b) => a + b, 0) / scrollVelocities.length;
            vector.push(meanScroll / 1000);
        } else {
            vector.push(0);
        }

        // Touch dynamics (if available)
        if (this.behavioralData.touchEvents.length > 0) {
            const touchCount = this.behavioralData.touchEvents.length;
            vector.push(touchCount / 100);
        } else {
            vector.push(0);
        }

        return vector;
    }

    calculateTypingRhythm() {
        if (this.behavioralData.keystrokes.length < 5) return 0;

        const intervals = this.behavioralData.keystrokes
            .filter(k => k.interval > 0)
            .map(k => k.interval);

        // Calculate coefficient of variation
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const std = Math.sqrt(intervals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / intervals.length);
        
        if (mean === 0) return 0;
        return std / mean;
    }

    // Simplified Random Projection (SimHash)
    generateSeed() {
        const seed = new Uint8Array(32);
        crypto.getRandomValues(seed);
        this.seed = Array.from(seed);
        return this.seed;
    }

    generateProjectionMatrix(d, k = 64) {
        // Simplified: use seed to generate pseudo-random matrix
        // In production, this would use AES-CTR-DRBG
        const matrix = [];
        
        for (let i = 0; i < k; i++) {
            const row = [];
            for (let j = 0; j < d; j++) {
                // Simple PRNG using seed
                const val = this.seededRandom(i * d + j);
                row.push((val - 0.5) * 2);  // Center around 0
            }
            matrix.push(row);
        }

        this.projectionMatrix = matrix;
        return matrix;
    }

    seededRandom(index) {
        if (!this.seed) return Math.random();
        
        let hash = 0;
        for (let i = 0; i < this.seed.length; i++) {
            hash = ((hash << 5) - hash) + this.seed[i] + index;
            hash = hash & hash;
        }
        return (Math.abs(hash) % 10000) / 10000;
    }

    // SimHash projection
    projectVector(X) {
        const k = 64;
        const d = X.length;

        if (!this.projectionMatrix) {
            this.generateProjectionMatrix(d, k);
        }

        const bits = [];
        for (let i = 0; i < k; i++) {
            let dot = 0;
            for (let j = 0; j < d; j++) {
                dot += this.projectionMatrix[i][j] * X[j];
            }
            bits.push(dot >= 0 ? 1 : 0);
        }

        return bits;
    }

    // Simplified Fuzzy Commitment
    async enroll() {
        const X = this.constructFeatureVector();
        const w = this.projectVector(X);

        // Generate canonical codeword (simplified: use hash of projection)
        const codeword = await this.generateCanonicalCodeword(w);
        this.canonicalCodeword = codeword;

        // Compute blinding factor
        const blindingFactor = w.map((bit, i) => bit ^ codeword[i]);
        this.blindingFactor = blindingFactor;

        return {
            codeword,
            blindingFactor,
            brailleSignature: this.bitsToBraille(codeword)
        };
    }

    async authenticate() {
        const X = this.constructFeatureVector();
        const w = this.projectVector(X);

        if (!this.blindingFactor) {
            throw new Error('No enrolled identity found');
        }

        // Recover noisy codeword
        const noisyCodeword = w.map((bit, i) => bit ^ this.blindingFactor[i]);

        // Simplified error correction: count bit differences
        const bitErrors = this.canonicalCodeword.reduce((sum, bit, i) => 
            sum + (bit !== noisyCodeword[i] ? 1 : 0), 0);

        // Allow some tolerance (e.g., up to 10 bit errors out of 64)
        const tolerance = 10;
        const matched = bitErrors <= tolerance;

        const confidence = Math.max(0, 100 - (bitErrors / tolerance) * 100);

        return {
            matched,
            confidence: confidence.toFixed(1),
            bitErrors,
            tolerance,
            recoveredCodeword: noisyCodeword,
            brailleSignature: this.bitsToBraille(this.canonicalCodeword)
        };
    }

    async generateCanonicalCodeword(bits) {
        // Simplified: hash the bits and use first 64 bits
        const bitString = bits.join('');
        const hash = await this.simpleHash(bitString);
        
        // Convert hash to 64-bit codeword
        const codeword = [];
        for (let i = 0; i < 64; i++) {
            const byteIndex = Math.floor(i / 8);
            const bitIndex = i % 8;
            const byte = parseInt(hash.substring(byteIndex * 2, (byteIndex + 1) * 2), 16);
            codeword.push((byte >> bitIndex) & 1);
        }

        return codeword;
    }

    // BBES: Bits to Braille mapping
    bitsToBraille(bits) {
        const bytes = [];
        for (let i = 0; i < bits.length; i += 8) {
            const byte = bits.slice(i, i + 8);
            const value = byte.reduce((acc, bit, idx) => acc + (bit << idx), 0);
            bytes.push(value);
        }

        // Map to Unicode Braille Patterns (U+2800 to U+28FF)
        const brailleChars = bytes.map(b => String.fromCharCode(0x2800 + b));
        return brailleChars.join('');
    }

    // Utility: Simple hash function
    async simpleHash(data) {
        const encoder = new TextEncoder();
        const dataBytes = typeof data === 'string' ? encoder.encode(data) : data;
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Get behavioral statistics
    getBehavioralStats() {
        const keystrokes = this.behavioralData.keystrokes.filter(k => k.interval > 0);
        const mouseMovements = this.behavioralData.mouseMovements.filter(m => m.velocity > 0);

        let keystrokeMean = 0, keystrokeStd = 0;
        if (keystrokes.length > 0) {
            const intervals = keystrokes.map(k => k.interval);
            keystrokeMean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const variance = intervals.reduce((sum, val) => sum + Math.pow(val - keystrokeMean, 2), 0) / intervals.length;
            keystrokeStd = Math.sqrt(variance);
        }

        let mouseVelocity = 0, mouseAccel = 0;
        if (mouseMovements.length > 0) {
            mouseVelocity = mouseMovements.reduce((a, b) => a + b.velocity, 0) / mouseMovements.length;
            mouseAccel = mouseMovements.reduce((sum, m) => sum + Math.pow(m.acceleration, 2), 0) / mouseMovements.length;
        }

        return {
            keystrokeMean: keystrokeMean.toFixed(1),
            keystrokeStd: keystrokeStd.toFixed(1),
            mouseVelocity: mouseVelocity.toFixed(1),
            mouseAccel: mouseAccel.toFixed(2),
            typingRhythm: this.calculateTypingRhythm().toFixed(3),
            interactionPatterns: (keystrokes.length + mouseMovements.length).toString()
        };
    }

    // Clear all data
    clear() {
        this.deviceFingerprint = null;
        this.behavioralData = {
            keystrokes: [],
            mouseMovements: [],
            scrollEvents: [],
            touchEvents: []
        };
        this.projectionMatrix = null;
        this.seed = null;
        this.canonicalCodeword = null;
        this.blindingFactor = null;
    }

    // Serialize for storage
    serialize() {
        return {
            deviceFingerprint: this.deviceFingerprint,
            behavioralData: this.behavioralData,
            seed: this.seed,
            canonicalCodeword: this.canonicalCodeword,
            blindingFactor: this.blindingFactor
        };
    }

    // Deserialize from storage
    deserialize(data) {
        if (data.deviceFingerprint) this.deviceFingerprint = data.deviceFingerprint;
        if (data.behavioralData) this.behavioralData = data.behavioralData;
        if (data.seed) this.seed = data.seed;
        if (data.canonicalCodeword) this.canonicalCodeword = data.canonicalCodeword;
        if (data.blindingFactor) this.blindingFactor = data.blindingFactor;
    }
}
