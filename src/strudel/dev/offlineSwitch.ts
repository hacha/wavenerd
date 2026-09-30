/**
 * Pretends to be offline for the Strudel integration: fails every cross-origin `fetch` like a lost network does.
 * The sounds of Strudel are the only thing the app fetches from other origins with `fetch`.
 *
 * Install it before `StrudelEngine`, since the engine starts loading the sounds at startup.
 */
export interface StrudelOfflineSwitch {
  offline: boolean;

  /** URLs that were failed by the switch. */
  readonly blocked: string[];

  /** Cross-origin URLs that were let through. */
  readonly passed: string[];
}

export function installStrudelOfflineSwitch(offline: boolean): StrudelOfflineSwitch {
  const state: StrudelOfflineSwitch = { offline, blocked: [], passed: [] };

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href);

    if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) {
      return originalFetch(input, init);
    }

    if (state.offline) {
      state.blocked.push(url.href);
      // same as Chrome without a network
      return Promise.reject(new TypeError('Failed to fetch'));
    }

    state.passed.push(url.href);
    return originalFetch(input, init);
  };

  return state;
}
