import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { type StrudelEngine, type StrudelEngineEvents } from '../../../strudel/StrudelEngine';
import { strudelFailedSoundsAtom } from '../atoms/strudel';

export function useStrudelSubscribers(engine: StrudelEngine) {
  const setFailedSounds = useSetAtom(strudelFailedSoundsAtom);

  useEffect(() => {
    setFailedSounds(engine.failedSounds);

    const handleChangeFailedSounds = ({ failedSounds }: StrudelEngineEvents['changeFailedSounds']) => {
      setFailedSounds(failedSounds);
    };
    engine.on('changeFailedSounds', handleChangeFailedSounds);

    return () => {
      engine.off('changeFailedSounds', handleChangeFailedSounds);
    };
  }, [engine, setFailedSounds]);
}
