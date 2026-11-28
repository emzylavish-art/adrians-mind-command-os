import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { LocalFile } from "@/lib/mind/types";
import { ActionOverlay } from "./conversation-menu";
import { BrowserActivity } from "./browser-activity";
export { BrowserActivity };
import { menuChip } from "./menu-material";

type Point = { x: number; y: number };

function SketchPad({ onSave }: { onSave: (file: File) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paths, setPaths] = useState<Point[][]>([]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 900, 540);
    ctx.strokeStyle = "#172333"; ctx.fillStyle = "#172333"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const path of paths) {
      if (!path.length) continue;
      ctx.beginPath(); ctx.arc(path[0].x, path[0].y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }, [paths]);
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) * 900 / box.width, y: (event.clientY - box.top) * 540 / box.height };
  }
  return <>
    <canvas ref={canvas} width={900} height={540} aria-label="Sketch pad" className="w-full touch-none rounded-panel bg-white"
      onPointerDown={event => { if (!event.isPrimary || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); const first = point(event); setPaths(old => [...old, [first]]); }}
      onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const next = point(event); setPaths(old => [...old.slice(0, -1), [...old[old.length - 1], next]]); }}
    />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!paths.length} className="min-h-11 px-2" onClick={() => setPaths(old => old.slice(0, -1))}>Undo stroke</button>
      <button type="button" disabled={!paths.length} className="min-h-11 px-2" onClick={() => canvas.current?.toBlob(blob => { if (blob) onSave(new File([blob], "Adrian sketch.png", {type:"image/png"})); }, "image/png")}>Attach sketch</button>
    </div>
  </>;
}

export function ChatComposerExtras({ files, onSelect, onImage, onResearch, onSearch, onProject }: {
  files: LocalFile[]; onSelect: (file: LocalFile) => void; onImage: (file: File) => void; onResearch: () => void; onSearch: () => void; onProject: () => void;
}) {
  const [panel, setPanel] = useState<"library" | "sketch" | null>(null);
  const [query, setQuery] = useState("");
  function open(next: typeof panel) {
    setQuery(""); setPanel(next);
    document.querySelectorAll("details.composer-more[open]").forEach(menu => menu.removeAttribute("open"));
  }
  const matches = files.filter(file => !file.archived && file.text && file.name.toLowerCase().includes(query.toLowerCase()));
  return <>
    <button type="button" style={menuChip} onClick={() => open("library")}>Add from library</button>
    <button type="button" style={menuChip} onClick={() => open("sketch")}>Sketch</button>
    <button type="button" style={menuChip} onClick={() => { open(null); onSearch(); }}>Web search</button>
    <button type="button" style={menuChip} onClick={() => { open(null); onProject(); }}>Work in a project</button>
    <button type="button" style={menuChip} onClick={() => { open(null); onResearch(); }}>Deep research</button>
    {panel && <ActionOverlay label="Composer tool" title={{library:"Add from library", sketch:"Sketch"}[panel]} onClose={() => open(null)}>
      {panel === "library" && <><input type="search" value={query} aria-label="Search library files" placeholder="Search files" className="min-h-11 w-full px-2" onChange={event => setQuery(event.target.value)} />
        {matches.map(file => <button type="button" className="min-h-11 px-2 text-left" key={file.id} onClick={() => { onSelect(file); open(null); }}>{file.name}</button>)}
        {!matches.length && <p className="text-sm text-muted">No matching files with readable text.</p>}</>}
      {panel === "sketch" && <SketchPad onSave={file => { onImage(file); open(null); }} />}
    </ActionOverlay>}
  </>;
}
