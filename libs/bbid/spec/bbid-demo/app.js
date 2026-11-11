// BBID Demo Application

class BBIDApp {
    constructor() {
        this.bbid = new BBIDCore();
        this.isCollecting = false;
        this.enrolled = false;
        this.init();
    }

    async init() {
        this.log('Initializing BBID system...', 'info');
        
        // Load stored identity if exists
        this.loadIdentity();
        
        // Collect initial device fingerprint
        await this.updateDeviceFingerprint();
        
        // Set up event listeners for behavioral data collection
        this.setupEventListeners();
        
        // Update UI
        this.updateUI();
        
        this.log('System ready', 'success');
    }

    setupEventListeners() {
        // Mouse movement tracking
        document.addEventListener('mousemove', (e) => {
            if (this.isCollecting) {
                this.bbid.recordMouseMove(performance.now(), e.clientX, e.clientY);
            }
        });

        // Scroll tracking
        document.addEventListener('scroll', () => {
            if (this.isCollecting) {
                this.bbid.recordScroll(performance.now(), window.scrollY);
            }
        });

        // Touch tracking (for mobile)
        document.addEventListener('touchstart', (e) => {
            if (this.isCollecting && e.touches.length > 0) {
                this.bbid.recordTouch(performance.now(), e.touches[0].clientX, e.touches[0].clientY, 'start');
            }
        });

        document.addEventListener('touchmove', (e) => {
            if (this.isCollecting && e.touches.length > 0) {
                this.bbid.recordTouch(performance.now(), e.touches[0].clientX, e.touches[0].clientY, 'move');
            }
        });

        document.addEventListener('touchend', (e) => {
            if (this.isCollecting) {
                this.bbid.recordTouch(performance.now(), 0, 0, 'end');
            }
        });
    }

    async updateDeviceFingerprint() {
        this.log('Collecting device fingerprint...', 'info');
        const fingerprint = await this.bbid.collectDeviceFingerprint();
        
        // Update UI
        document.getElementById('screenRes').textContent = 
            `${fingerprint.screen.width}x${fingerprint.screen.height}`;
        document.getElementById('colorDepth').textContent = 
            `${fingerprint.screen.colorDepth} bits`;
        document.getElementById('platform').textContent = 
            fingerprint.platform.platform || 'Unknown';
        document.getElementById('canvasHash').textContent = 
            fingerprint.canvas.hash.substring(0, 16) + '...';
        document.getElementById('webglVendor').textContent = 
            fingerprint.webgl.supported ? (fingerprint.webgl.vendor || 'N/A') : 'Not supported';
        document.getElementById('webglRenderer').textContent = 
            fingerprint.webgl.supported ? (fingerprint.webgl.renderer || 'N/A') : 'Not supported';
        document.getElementById('timezone').textContent = 
            fingerprint.platform.timezone || 'Unknown';
        document.getElementById('language').textContent = 
            fingerprint.platform.language || 'Unknown';
        
        this.log('Device fingerprint collected', 'success');
    }

    updateBehavioralStats() {
        const stats = this.bbid.getBehavioralStats();
        
        document.getElementById('keystrokeMean').textContent = 
            `${stats.keystrokeMean} ms`;
        document.getElementById('keystrokeStd').textContent = 
            `${stats.keystrokeStd} ms`;
        document.getElementById('mouseVelocity').textContent = 
            `${stats.mouseVelocity} px/s`;
        document.getElementById('mouseAccel').textContent = 
            stats.mouseAccel;
        document.getElementById('typingRhythm').textContent = 
            stats.typingRhythm;
        document.getElementById('interactionPatterns').textContent = 
            stats.interactionPatterns;
    }

    async startEnrollment() {
        this.log('Starting enrollment process...', 'info');
        
        // Ensure we have enough behavioral data
        if (this.bbid.behavioralData.keystrokes.length < 10) {
            this.log('Please type more in the text area before enrolling', 'warning');
            this.isCollecting = true;
            document.getElementById('behavioralInput').focus();
            return;
        }

        try {
            this.log('Generating identity token...', 'info');
            const result = await this.bbid.enroll();
            
            // Store the identity
            this.saveIdentity();
            this.enrolled = true;
            
            // Display Braille signature
            document.getElementById('brailleSignature').textContent = result.brailleSignature;
            document.getElementById('brailleDisplay').style.display = 'block';
            
            this.log(`Enrollment successful! BBID: ${result.brailleSignature}`, 'success');
            this.log(`Canonical codeword: ${result.codeword.slice(0, 16).join('')}...`, 'info');
            
            this.updateUI();
        } catch (error) {
            this.log(`Enrollment failed: ${error.message}`, 'warning');
        }
    }

    async authenticate() {
        if (!this.enrolled) {
            this.log('No enrolled identity found. Please enroll first.', 'warning');
            return;
        }

        this.log('Starting authentication...', 'info');
        
        // Collect fresh behavioral data if needed
        if (this.bbid.behavioralData.keystrokes.length < 5) {
            this.log('Collecting fresh behavioral data...', 'info');
            this.isCollecting = true;
            document.getElementById('behavioralInput').focus();
            this.log('Please type a few characters, then click Authenticate again', 'warning');
            return;
        }

        try {
            const result = await this.bbid.authenticate();
            
            if (result.matched) {
                document.getElementById('matchConfidence').textContent = `${result.confidence}%`;
                document.getElementById('identityMatch').style.display = 'block';
                
                this.log(`Authentication successful! Confidence: ${result.confidence}%`, 'success');
                this.log(`Bit errors: ${result.bitErrors}/${result.tolerance}`, 'info');
            } else {
                document.getElementById('identityMatch').style.display = 'none';
                this.log(`Authentication failed. Too many bit errors: ${result.bitErrors}/${result.tolerance}`, 'warning');
            }
            
            // Update Braille signature display
            document.getElementById('brailleSignature').textContent = result.brailleSignature;
            document.getElementById('brailleDisplay').style.display = 'block';
            
        } catch (error) {
            this.log(`Authentication failed: ${error.message}`, 'warning');
        }
    }

    collectBehavioralData() {
        this.isCollecting = !this.isCollecting;
        
        if (this.isCollecting) {
            this.log('Behavioral data collection started', 'info');
            document.getElementById('behavioralInput').focus();
        } else {
            this.log('Behavioral data collection stopped', 'info');
        }
        
        this.updateUI();
    }

    handleInput() {
        if (!this.isCollecting) {
            this.isCollecting = true;
        }

        const input = document.getElementById('behavioralInput');
        const text = input.value;
        
        // Record keystroke (simplified - in production would track actual key events)
        this.bbid.recordKeystroke(performance.now(), text[text.length - 1]);
        
        // Update progress
        const progress = Math.min(100, (text.length / 100) * 100);
        document.getElementById('dataProgress').style.width = `${progress}%`;
        document.getElementById('dataCollected').textContent = text.length;
        
        // Update stats
        this.updateBehavioralStats();
    }

    clearIdentity() {
        if (confirm('Are you sure you want to clear your enrolled identity?')) {
            this.bbid.clear();
            localStorage.removeItem('bbid-identity');
            this.enrolled = false;
            
            document.getElementById('brailleDisplay').style.display = 'none';
            document.getElementById('identityMatch').style.display = 'none';
            document.getElementById('behavioralInput').value = '';
            document.getElementById('dataProgress').style.width = '0%';
            document.getElementById('dataCollected').textContent = '0';
            
            this.log('Identity cleared', 'info');
            this.updateUI();
        }
    }

    saveIdentity() {
        const data = this.bbid.serialize();
        localStorage.setItem('bbid-identity', JSON.stringify(data));
        this.log('Identity saved to local storage', 'info');
    }

    loadIdentity() {
        const stored = localStorage.getItem('bbid-identity');
        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.bbid.deserialize(data);
                this.enrolled = true;
                
                // Display existing Braille signature
                if (this.bbid.canonicalCodeword) {
                    const signature = this.bbid.bitsToBraille(this.bbid.canonicalCodeword);
                    document.getElementById('brailleSignature').textContent = signature;
                    document.getElementById('brailleDisplay').style.display = 'block';
                }
                
                this.log('Loaded existing identity from local storage', 'success');
            } catch (error) {
                this.log('Failed to load identity: ' + error.message, 'warning');
            }
        }
    }

    updateUI() {
        // System status
        document.getElementById('systemStatus').textContent = 'Ready';
        
        // Identity state
        document.getElementById('identityState').textContent = 
            this.enrolled ? 'Enrolled' : 'Not Enrolled';
        document.getElementById('identityState').style.color = 
            this.enrolled ? '#00ff88' : '#eaeaea';
        
        // Data collection
        const totalSamples = 
            this.bbid.behavioralData.keystrokes.length +
            this.bbid.behavioralData.mouseMovements.length +
            this.bbid.behavioralData.scrollEvents.length +
            this.bbid.behavioralData.touchEvents.length;
        document.getElementById('dataCollection').textContent = 
            `${totalSamples} samples`;
        
        // Last update
        document.getElementById('lastUpdate').textContent = 
            new Date().toLocaleTimeString();
    }

    log(message, type = 'info') {
        const logArea = document.getElementById('systemLog');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bbidApp = new BBIDApp();
});

// Global functions for button handlers
function startEnrollment() {
    window.bbidApp.startEnrollment();
}

function authenticate() {
    window.bbidApp.authenticate();
}

function collectBehavioralData() {
    window.bbidApp.collectBehavioralData();
}

function clearIdentity() {
    window.bbidApp.clearIdentity();
}

function handleInput() {
    window.bbidApp.handleInput();
}
