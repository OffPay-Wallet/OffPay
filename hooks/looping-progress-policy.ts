export function shouldRunLoopingProgress(active: boolean, reduceMotion: boolean): boolean {
  return active && !reduceMotion;
}
