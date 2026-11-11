export class CampAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private enabled = false;
  private suspended = false;
  private intensity = 1;
  setIntensity(value: number) {
    const intensity = Math.max(0, Math.min(1, value));
    if (intensity === this.intensity) return;
    this.intensity = intensity;
    this.applyVolume();
  }
  private applyVolume() {
    if (this.context && this.gain) this.gain.gain.setTargetAtTime(
      this.enabled && !this.suspended ? 0.08 * this.intensity : 0,
      this.context.currentTime, 0.12,
    );
  }
  private async syncPlayback() {
    if (!this.context) return;
    this.applyVolume();
    if (this.suspended) await this.context.suspend();
    else if (this.enabled) await this.context.resume();
  }
  async setSuspended(suspended: boolean) {
    this.suspended = suspended;
    await this.syncPlayback();
  }
  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.context && enabled) {
      const context = new AudioContext();
      this.context = context;
      const buffer = context.createBuffer(
        1,
        context.sampleRate * 3,
        context.sampleRate,
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * (Math.random() > 0.999 ? 1 : 0.13);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      const gain = context.createGain();
      gain.gain.value = 0;
      this.gain = gain;
      source.connect(filter).connect(gain).connect(context.destination);
      source.start();
    }
    await this.syncPlayback();
  }
}
