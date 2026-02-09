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

// Alias expected by @strudel/webaudio >=1.2.6
export const setAudioContext = setDefaultAudioContext;

export function getAudioContextCurrentTime() {
  return getAudioContext().currentTime;
}
