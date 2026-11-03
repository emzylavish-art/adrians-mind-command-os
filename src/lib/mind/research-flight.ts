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
