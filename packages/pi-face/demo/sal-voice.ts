const DEFAULT_ASSET_BASE = "https://salus-ryan.github.io/sal-ensemble-lab/assets";

/**
 * Plays the five canonical, alignment-locked Sal member passes and exposes a
 * bounded amplitude signal that a truthful visual adapter can observe.
 */
export class SalVoiceAdapter {
  private context?: AudioContext;
  private buffers: AudioBuffer[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private analyser?: AnalyserNode;
  private memberAnalysers: AnalyserNode[] = [];
  private samples = new Uint8Array(1024);
  private memberSamples = Array.from({ length: 5 }, () => new Uint8Array(256));
  private playbackId = 0;
  private _active = false;

  constructor(private readonly assetBase = DEFAULT_ASSET_BASE) {}

  get active() {
    return this._active;
  }

  private async load() {
    this.context ??= new AudioContext();
    if (this.buffers.length) return;
    const paths = Array.from({ length: 5 }, (_, index) => `${this.assetBase}/member-${index + 1}.mp3`);
    this.buffers = await Promise.all(paths.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Sal Voice member failed to load: HTTP ${response.status}`);
      return this.context!.decodeAudioData(await response.arrayBuffer());
    }));
  }

  async play(onEnded: () => void) {
    this.stop();
    await this.load();
    await this.context!.resume();

    const playbackId = ++this.playbackId;
    const mix = this.context!.createGain();
    const analyser = this.context!.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.58;
    mix.connect(analyser).connect(this.context!.destination);
    this.analyser = analyser;

    const launch = this.context!.currentTime + 0.06;
    let ended = 0;
    this.sources = this.buffers.map((buffer, index) => {
      const source = this.context!.createBufferSource();
      const delay = this.context!.createDelay(0.02);
      const panner = this.context!.createStereoPanner();
      const gain = this.context!.createGain();
      const memberAnalyser = this.context!.createAnalyser();
      memberAnalyser.fftSize = 256;
      memberAnalyser.smoothingTimeConstant = 0.45;
      source.buffer = buffer;
      delay.delayTime.value = index / Math.max(1, this.buffers.length - 1) * 0.008;
      panner.pan.value = -0.7 + index / Math.max(1, this.buffers.length - 1) * 1.4;
      gain.gain.value = 0.72 / Math.sqrt(this.buffers.length);
      source.connect(delay).connect(panner).connect(gain).connect(memberAnalyser).connect(mix);
      this.memberAnalysers[index] = memberAnalyser;
      source.addEventListener("ended", () => {
        ended++;
        if (ended !== this.buffers.length || playbackId !== this.playbackId) return;
        this._active = false;
        this.sources = [];
        this.analyser = undefined;
        this.memberAnalysers = [];
        onEnded();
      });
      source.start(launch);
      return source;
    });
    this._active = true;
  }

  stop() {
    this.playbackId++;
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
    this.analyser = undefined;
    this.memberAnalysers = [];
    this._active = false;
  }

  private readIntensity(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>) {
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      energy += centered * centered;
    }
    const rms = Math.sqrt(energy / samples.length);
    return Math.max(0, Math.min(1, (rms - 0.012) * 8.5));
  }

  intensity() {
    if (!this._active || !this.analyser) return 0;
    return this.readIntensity(this.analyser, this.samples);
  }

  memberIntensities() {
    if (!this._active) return [0, 0, 0, 0, 0];
    return this.memberAnalysers.map((analyser, index) =>
      this.readIntensity(analyser, this.memberSamples[index]));
  }
}
