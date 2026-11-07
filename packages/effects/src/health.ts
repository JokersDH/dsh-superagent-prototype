/** Minimal health surface: the application claims one named entry per effect kind and keeps the board elsewhere. */
export interface HealthSink {
  claim(name: string): { set(entry: { state: 'ready' | 'error'; detail: string; at: string }): void }
}
