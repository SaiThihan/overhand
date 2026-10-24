let actx: AudioContext | null = null;
/** The page's one AudioContext, shared by every sound; made on first use, which must follow a gesture. */
export function audio(): AudioContext {
  actx ??= new AudioContext();
  return actx;
}
