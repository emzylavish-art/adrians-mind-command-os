/** End-call vs research: barge-in/mute must not abort; End may confirm abort. */

import {
  getActiveResearchSnapshot,
  isResearchInFlight,
  requestResearchAbort,
  type ResearchVoiceState,
} from "./active-research-run.ts";

export function shouldAbortResearchOnVoiceEnd(input: {
  researchState: ResearchVoiceState | null;
  userConfirmedEnd: boolean;
}): boolean {
  if (!isResearchInFlight(input.researchState)) return false;
  return input.userConfirmedEnd;
}

export function onVoiceMuteOrBargeIn(): { abortedResearch: false } {
  // Explicit no-op contract: mute / barge-in never cancel deep fetch.
  return { abortedResearch: false };
}

export function onVoiceEndConfirmed(): { abortedResearch: boolean } {
  const snap = getActiveResearchSnapshot();
  if (!shouldAbortResearchOnVoiceEnd({ researchState: snap.state, userConfirmedEnd: true })) {
    return { abortedResearch: false };
  }
  requestResearchAbort("end");
  return { abortedResearch: true };
}
