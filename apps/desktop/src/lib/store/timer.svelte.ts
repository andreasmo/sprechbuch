/**
 * Aufnahme-Timer: misst Sitzungsdauer und das tatsächliche Sprechtempo
 * (Wörter, um die die Leseposition vorgerückt ist, pro Minute).
 */

/** Unterhalb dieser Messdauer ist ein Tempo nicht aussagekräftig. */
const MIN_MS = 20_000;

export class SessionTimer {
  running = $state(false);
  /** vor der laufenden Etappe angesammelte Zeit */
  #before = $state(0);
  #since = 0;
  #startWords: number | null = $state(null);
  now = $state(Date.now());
  words = $state(0);
  #tick: ReturnType<typeof setInterval> | null = null;

  get elapsed(): number {
    return this.#before + (this.running ? this.now - this.#since : 0);
  }

  get started(): boolean {
    return this.#startWords !== null;
  }

  /** Wörter pro Minute oder null, solange zu wenig gemessen wurde */
  get wpm(): number | null {
    const ms = this.elapsed;
    return ms >= MIN_MS && this.words > 0 ? Math.round(this.words / (ms / 60_000)) : null;
  }

  start(position: number): void {
    if (this.running) return;
    if (this.#startWords === null) this.#startWords = position;
    this.#since = Date.now();
    this.now = this.#since;
    this.running = true;
    this.#tick = setInterval(() => (this.now = Date.now()), 1000);
  }

  pause(): void {
    if (!this.running) return;
    this.now = Date.now();
    this.#before += this.now - this.#since;
    this.running = false;
    if (this.#tick) clearInterval(this.#tick);
    this.#tick = null;
  }

  toggle(position: number): void {
    if (this.running) this.pause();
    else this.start(position);
  }

  /** Leseposition als Wortindex im Buch melden */
  track(position: number): void {
    if (this.#startWords !== null && this.running) this.words = Math.max(0, position - this.#startWords);
  }

  reset(): void {
    this.pause();
    this.#before = 0;
    this.#startWords = null;
    this.words = 0;
  }

  dispose(): void {
    if (this.#tick) clearInterval(this.#tick);
  }
}

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
