import campfireUrl from "./assets/campfire-loop.wav?url";
import { t } from "./i18n";

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
    if (!this.context && enabled) {
      const context = new AudioContext();
      try {
        const response = await fetch(campfireUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain).connect(context.destination);
        source.start();
        this.context = context;
        this.gain = gain;
      } catch (error) {
        await context.close().catch(() => {});
        throw new Error(t("audioLoadFailed"), { cause: error });
      }
    }
    this.enabled = enabled;
    await this.syncPlayback();
  }
}
