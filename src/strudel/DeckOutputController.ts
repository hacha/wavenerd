import { getSuperdoughAudioController } from 'superdough';

/**
 * Replacement for `SuperdoughOutput` that sends every orbit into a deck node
 * instead of `ctx.destination`.
 */
class DeckOutput {
  public readonly audio: AudioContext;
  public readonly destination: AudioNode;

  public constructor(audio: AudioContext, destination: AudioNode) {
    this.audio = audio;
    this.destination = destination;
  }

  public connectToDestination = (input: AudioNode): void => {
    // same upmix as SuperdoughOutput. multichannel orbits (`channels`) are not supported
    const stereoMix = new StereoPannerNode(this.audio);
    input.connect(stereoMix);
    stereoMix.connect(this.destination);
  };

  public reset(): void {
    // orbits are disconnected by the controller itself
  }

  public disconnect(): void {
    // the destination is owned by the deck
  }
}

type SuperdoughAudioControllerConstructor = new (audio: AudioContext) => any;

let DeckOutputControllerClass: SuperdoughAudioControllerConstructor | null = null;

/**
 * Create a superdough audio controller whose orbits are routed into `destination`.
 *
 * Call it after `setAudioContext()`.
 * Make it the current controller with `setSuperdoughAudioController()` right before each `superdough()` call.
 */
export function createDeckOutputController(audio: AudioContext, destination: AudioNode) {
  if (DeckOutputControllerClass == null) {
    // Take the class bundled in the main entry of superdough.
    // Do not deep import `superdough/superdoughoutput.mjs`; it duplicates the AudioContext holder module.
    const channelCount = audio.destination.channelCount;
    const defaultController = getSuperdoughAudioController();
    audio.destination.channelCount = channelCount;

    // the default controller is connected to ctx.destination. we never use it
    defaultController.output.disconnect();

    const Base: SuperdoughAudioControllerConstructor = defaultController.constructor;

    DeckOutputControllerClass = class DeckOutputController extends Base {
      public constructor(audio: AudioContext) {
        const channelCount = audio.destination.channelCount;
        super(audio);
        audio.destination.channelCount = channelCount;

        // the base constructor connects its own output to ctx.destination
        this.output.disconnect();
      }
    };
  }

  const controller = new DeckOutputControllerClass(audio);
  controller.output = new DeckOutput(audio, destination);
  return controller;
}
