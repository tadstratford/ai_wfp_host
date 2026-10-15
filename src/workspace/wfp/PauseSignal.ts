// Pause signal thrown by api.pauseForInput in the host.
//
// The host doesn't have continuations across HTTP boundaries, so its
// pauseForInput cannot return a Promise that resolves with the user's
// response. Instead it throws this signal, which the executor catches and
// converts into a "session.waitingForInput = true" state with the pause
// prompt stored on session.metadata. The browser then renders the form,
// and the resume endpoint stuffs the form values into session.parameters
// and re-enters the executor from the next node.
//
// Tool code should treat `await api.pauseForInput(...)` as fire-and-forget:
// the value returned by the await is never reached because the call throws.
// The next node in the workflow consumes the form values via getParameter.

import type { PausePrompt } from "wfp-api";

export class PauseSignal extends Error {
  readonly prompt: PausePrompt;
  readonly pauseId: string;

  constructor(prompt: PausePrompt, pauseId: string) {
    super("WFP_PAUSE");
    this.name = "PauseSignal";
    this.prompt = prompt;
    this.pauseId = pauseId;
  }
}

export function isPauseSignal(err: unknown): err is PauseSignal {
  return err instanceof PauseSignal;
}
