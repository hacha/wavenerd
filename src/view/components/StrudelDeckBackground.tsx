import { useContext, useEffect, useRef } from 'react';
import { type StrudelDeck } from '../../strudel/StrudelDeck';
import { drawStrudelVisual, fitStrudelCanvas, setStrudelVisualColors } from '../../strudel/StrudelVisuals';
import { StuffContext } from '../StuffContext';
import { strudelThemeSettings } from '../codemirror/strudelTheme';

/**
 * Drawings of Strudel that are not inline, such as `.pianoroll()`, behind the code of the deck.
 * The Strudel REPL draws them behind the whole page. Each one has its own canvas, stacked in the order of the code.
 */
export const StrudelDeckBackground: React.FC<{
  deck: StrudelDeck;
  className?: string;
}> = ({ deck, className }) => {
  const { frameEmitter } = useContext(StuffContext)!;
  const refRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = refRoot.current;
    if (root == null) { return; }

    const canvases = new Map<string, HTMLCanvasElement>();

    const handleFrame = frameEmitter.on('update', () => {
      const visuals = deck.activeVisuals.filter((visual) => visual.to == null);

      for (const [id, canvas] of canvases) {
        if (!visuals.some((visual) => visual.id === id)) {
          canvas.remove();
          canvases.delete(id);
        }
      }

      if (visuals.length === 0) { return; }

      const cycle = deck.displayCycle;
      const cps = deck.engine.clock.cps;
      setStrudelVisualColors(strudelThemeSettings.foreground, strudelThemeSettings.gutterForeground);

      visuals.forEach((visual, index) => {
        let canvas = canvases.get(visual.id);
        if (canvas == null) {
          canvas = document.createElement('canvas');
          canvas.className = 'absolute inset-0 w-full h-full';
          canvases.set(visual.id, canvas);
        }
        // keep the order of the code
        if (root.children[index] !== canvas) {
          root.insertBefore(canvas, root.children[index] ?? null);
        }

        fitStrudelCanvas(canvas);
        drawStrudelVisual(visual, canvas, cycle, cps);
      });
    });

    return () => {
      frameEmitter.off('update', handleFrame);
      canvases.forEach((canvas) => canvas.remove());
    };
  }, [deck, frameEmitter]);

  return <div ref={refRoot} className={className} />;
};
