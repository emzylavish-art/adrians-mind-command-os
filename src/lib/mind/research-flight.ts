/**
 * Single-flight gate for the Research page check. A second click while a search is in
 * flight is refused, so it cannot spend a second provider call or let a slower, older
 * response overwrite the newer query's citations.
 */
export type SingleFlight = {
  begin(): number | null;
  isCurrent(token: number): boolean;
  end(token: number): void;
  busy(): boolean;
};

export function createSingleFlight(): SingleFlight {
  let seq = 0;
  let active: number | null = null;
  return {
    begin() {
      if (active !== null) return null;
      seq += 1;
      active = seq;
      return active;
    },
    isCurrent(token) {
      return active !== null && active === token;
    },
    end(token) {
      if (active === token) active = null;
    },
    busy() {
      return active !== null;
    },
  };
}

/**
 * Run `work` only if the gate is free. Refused runs never call `work`; the gate is
 * always released, even when `work` throws (the error is rethrown).
 */
export async function runInFlight<T>(
  flight: SingleFlight,
  work: (token: number) => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const token = flight.begin();
  if (token === null) return { ran: false };
  try {
    return { ran: true, value: await work(token) };
  } finally {
    flight.end(token);
  }
}
