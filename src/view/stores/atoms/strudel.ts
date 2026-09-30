import { atom } from 'jotai';

/** Names of the Strudel sound sources that could not be loaded. */
export const strudelFailedSoundsAtom = atom<string[]>([]);

/** Names of the Strudel sounds whose audio file failed to load while playing. */
export const strudelFailedFilesAtom = atom<string[]>([]);
