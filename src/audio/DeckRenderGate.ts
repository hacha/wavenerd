import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';

interface DeckRenderer {
  render(...args: unknown[]): void;
  readBuffer(): Promise<[Float32Array, Float32Array]>;
}

const BLOCK_SIZE = 128;

/**
 * Stops the GPU work of a GLSL deck while keeping its `update()` going.
 *
 * `WavenerdDeck.update()` also advances the BeatManager, which is the clock of the Strudel decks,
 * so the deck cannot simply be paused. While disabled, the deck skips the draw and the readback
 * and writes silence instead.
 *
 * Wraps the renderer of the deck, which is a private field. Does nothing if the renderer is not found.
 */
export class DeckRenderGate {
  public readonly deck: WavenerdDeck;

  private __enabled = true;
  private __isWrapped = false;
  private __onAudible: ((time: number) => void) | null = null;

  public get enabled(): boolean {
    return this.__enabled;
  }

  public constructor(deck: WavenerdDeck) {
    this.deck = deck;

    const renderer: DeckRenderer | undefined = (deck as any).__renderer;
    if (typeof renderer?.render !== 'function' || typeof renderer?.readBuffer !== 'function') {
      console.warn('DeckRenderGate: the renderer of the deck is not found. The deck keeps rendering.');
      return;
    }
    this.__isWrapped = true;

    const render = renderer.render.bind(renderer);
    const readBuffer = renderer.readBuffer.bind(renderer);

    // Read back only what is drawn after the gate opened. The framebuffer still has an old chunk otherwise.
    let hasDrawn = false;

    renderer.render = (...args) => {
      if (!this.__enabled) { return; }
      hasDrawn = true;
      render(...args);
    };

    renderer.readBuffer = () => {
      const shouldRead = this.__enabled && hasDrawn;
      hasDrawn = false;

      if (this.__enabled) {
        // `update()` reads the buffer before it advances the write position.
        // A deck without a program never draws, so do not wait for a draw.
        const onAudible = this.__onAudible;
        this.__onAudible = null;
        onAudible?.(deck.bufferWriteBlocks * BLOCK_SIZE / deck.sampleRate);
      }

      if (!shouldRead) {
        // a new buffer every time, since the deck transfers it to the audio thread
        const frames = deck.framesPerRender;
        return Promise.resolve([new Float32Array(frames), new Float32Array(frames)]);
      }

      return readBuffer();
    };
  }

  /**
   * Stop rendering. The deck outputs silence, after what is already buffered.
   */
  public disable(): void {
    if (!this.__isWrapped) { return; }

    this.__enabled = false;
    this.__onAudible = null;
  }

  /**
   * Resume rendering. The silence that is already buffered plays first.
   *
   * @param onAudible Called with the AudioContext time at which the first rendered chunk plays.
   *   Called right away if there is no silence to wait for.
   */
  public enable(onAudible?: (time: number) => void): void {
    const isWaiting = !this.__enabled || this.__onAudible != null;
    this.__enabled = true;

    if (!isWaiting || !this.deck.isPlaying) {
      this.__onAudible = null;
      onAudible?.(this.deck.audio.currentTime);
    } else {
      this.__onAudible = onAudible ?? null;
    }
  }
}
