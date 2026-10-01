import { useContext, useEffect, useRef } from 'react';
import { type StrudelDeck } from '../../strudel/StrudelDeck';
import { drawStrudelVisual, fitStrudelCanvas, runStrudelDraw, setStrudelVisualColors } from '../../strudel/StrudelVisuals';
import { StuffContext } from '../StuffContext';
import { strudelThemeSettings } from '../codemirror/strudelTheme';

/**
 * Drawings of Strudel that are not inline, such as `.pianoroll()`, behind the code of the deck.
 * The Strudel REPL draws them behind the whole page. Each one has its own canvas, stacked in the order of the code,
 * over the canvases of `getDrawContext` that `.draw(fn)` draws on.
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

    // put the canvases in order, and fit them to the page
    const mount = (list: HTMLCanvasElement[]): void => {
      for (const child of [...root.children]) {
        if (!list.includes(child as HTMLCanvasElement)) {
          child.remove();
        }
      }

      list.forEach((canvas, index) => {
        if (root.children[index] !== canvas) {
          root.insertBefore(canvas, root.children[index] ?? null);
        }
        fitStrudelCanvas(canvas);
      });
    };

    const handleFrame = frameEmitter.on('update', () => {
      const visuals = deck.activeVisuals.filter((visual) => visual.to == null);
      const drawCanvases = deck.activeDrawCanvases;

      for (const id of canvases.keys()) {
        if (!visuals.some((visual) => visual.id === id && visual.kind !== 'draw')) {
          canvases.delete(id);
        }
      }

      const visualCanvases = visuals.flatMap((visual) => {
        if (visual.kind === 'draw') { return []; }

        let canvas = canvases.get(visual.id);
        if (canvas == null) {
          canvas = document.createElement('canvas');
          canvas.className = 'absolute inset-0 w-full h-full';
          canvases.set(visual.id, canvas);
        }
        return [{ visual, canvas }];
      });

      const list = () => [...drawCanvases.values(), ...visualCanvases.map(({ canvas }) => canvas)];
      mount(list());

      if (visuals.length === 0) { return; }

      const cycle = deck.displayCycle;
      const cps = deck.engine.clock.cps;
      setStrudelVisualColors(strudelThemeSettings.foreground, strudelThemeSettings.gutterForeground);

      const drawCanvasCount = drawCanvases.size;
      for (const visual of visuals) {
        if (visual.kind === 'draw') {
          runStrudelDraw(visual, drawCanvases, cycle, cps);
        }
      }
      // `getDrawContext` with a new id inside a callback
      if (drawCanvases.size !== drawCanvasCount) {
        mount(list());
      }

      for (const { visual, canvas } of visualCanvases) {
        drawStrudelVisual(visual, canvas, cycle, cps);
      }
    });

    return () => {
      frameEmitter.off('update', handleFrame);
      root.replaceChildren();
    };
  }, [deck, frameEmitter]);

  return <div ref={refRoot} className={className} />;
};
