import { Component, type ErrorInfo, type ReactNode } from "react";
export class SurfaceErrorBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not log workspace content or component props. */ }
  render() { return this.state.failed ? <section role="alert" className="m-4 space-y-3 rounded-panel border border-danger p-4"><h2 className="font-semibold">{this.props.name} could not be displayed</h2><p className="text-sm">Saved workspace data was not cleared. Reopen this surface or reload to recover. Export any unsaved text still visible before reloading.</p><button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => this.setState({ failed: false })}>Try this surface again</button><button type="button" className="ml-2 min-h-11 rounded-panel border border-line px-3" onClick={() => window.location.reload()}>Reload saved workspace</button></section> : this.props.children; }
}
