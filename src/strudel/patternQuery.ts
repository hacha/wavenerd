type Pattern = any;
type Hap = any;

/** How deep we are in our own queries of a pattern. */
let queryDepth = 0;

/**
 * Query a pattern, and mark that we are querying it.
 * Visual methods called at query time (e.g. inside `every`) then know they are not part of an evaluation.
 */
export function queryPattern(pattern: Pattern, begin: number, end: number, controls: Record<string, any>): Hap[] {
  queryDepth++;
  try {
    return pattern.queryArc(begin, end, controls);
  } finally {
    queryDepth--;
  }
}

/** Whether we are inside {@link queryPattern}. */
export function isQueryingPattern(): boolean {
  return queryDepth > 0;
}
