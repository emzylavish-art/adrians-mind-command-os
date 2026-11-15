export function EveAvatar(props: { state: "idle" | "listening" | "speaking"; size?: "call" | "panel" }) {
  const label = props.state === "speaking" ? "EVE is speaking" : props.state === "listening" ? "EVE is listening" : "EVE is here";
  return (
    <figure className={`eve-avatar is-${props.state} is-${props.size || "call"}`} data-testid="eve-avatar" data-state={props.state}>
      <img src="/brand/eve-idle.jpg" alt="EVE, an AI companion" />
      <figcaption>{label} · AI</figcaption>
    </figure>
  );
}
