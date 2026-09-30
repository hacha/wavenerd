import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { type StrudelEngine, type StrudelEngineEvents } from '../../../strudel/StrudelEngine';
import { strudelFailedFilesAtom, strudelFailedSoundsAtom } from '../atoms/strudel';

export function useStrudelSubscribers(engine: StrudelEngine) {
  const setFailedSounds = useSetAtom(strudelFailedSoundsAtom);
  const setFailedFiles = useSetAtom(strudelFailedFilesAtom);

  useEffect(() => {
    setFailedSounds(engine.failedSounds);
    setFailedFiles(engine.failedFiles);

    const handleChangeFailedSounds = ({ failedSounds }: StrudelEngineEvents['changeFailedSounds']) => {
      setFailedSounds(failedSounds);
    };
    engine.on('changeFailedSounds', handleChangeFailedSounds);

    const handleChangeFailedFiles = ({ failedFiles }: StrudelEngineEvents['changeFailedFiles']) => {
      setFailedFiles(failedFiles);
    };
    engine.on('changeFailedFiles', handleChangeFailedFiles);

    return () => {
      engine.off('changeFailedSounds', handleChangeFailedSounds);
      engine.off('changeFailedFiles', handleChangeFailedFiles);
    };
  }, [engine, setFailedSounds, setFailedFiles]);
}
