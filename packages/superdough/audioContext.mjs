/*
audioContext.mjs - AudioContext management for wavenerd-superdough fork
This fork manages its own AudioContext to ensure all Strudel components share the same instance.
*/

let audioContext;

export const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
};

export const setDefaultAudioContext = (ac) => {
  audioContext = ac;
  return audioContext;
};

export function getAudioContextCurrentTime() {
  return getAudioContext().currentTime;
}
