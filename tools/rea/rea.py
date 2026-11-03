#!/usr/bin/env python3
"""REA (Reverse Engineer Anything): offline repository reconnaissance utility.

Scans a user-selected directory for file inventory, language distribution, likely
entrypoints, dependency manifests, and security-relevant markers. It does not
execute discovered code or contact external systems.
"""
from __future__ import annotations
import argparse, json, os, re
from collections import Counter
from pathlib import Path

SKIP_DIRS={".git","node_modules","vendor",".venv","venv","dist","build","target","__pycache__"}
EXT_LANG={".py":"Python",".js":"JavaScript",".mjs":"JavaScript",".ts":"TypeScript",".tsx":"TypeScript",".jsx":"JavaScript/React",".go":"Go",".rs":"Rust",".java":"Java",".kt":"Kotlin",".c":"C",".h":"C/C++ header",".cpp":"C++",".cs":"C#",".php":"PHP",".rb":"Ruby",".ps1":"PowerShell",".sh":"Shell",".yml":"YAML",".yaml":"YAML",".json":"JSON",".toml":"TOML",".md":"Markdown"}
MANIFESTS={"package.json","pyproject.toml","requirements.txt","Cargo.toml","go.mod","pom.xml","build.gradle","Gemfile","composer.json"}
MARKERS={"TODO":r"\bTODO\b","FIXME":r"\bFIXME\b","credentials":r"(?i)(api[_-]?key|secret|password|token)\s*[:=]","network":r"(?i)(requests\.(get|post)|fetch\(|axios\.|https?://)"}
def scan(root:Path):
    files=[]; langs=Counter(); manifests=[]; entrypoints=[]; findings=[]
    for base,dirs,names in os.walk(root):
        dirs[:]=[d for d in dirs if d not in SKIP_DIRS and not d.startswith(".cache")]
        for name in names:
            p=Path(base)/name
            try: rel=p.relative_to(root).as_posix(); size=p.stat().st_size
            except OSError: continue
            files.append({"path":rel,"bytes":size})
            langs[EXT_LANG.get(p.suffix.lower(),"Other")]+=1
            if name in MANIFESTS: manifests.append(rel)
            if name.lower() in {"main.py","app.py","index.js","index.ts","server.js","server.ts","main.go","main.rs","program.cs"}: entrypoints.append(rel)
            if size>1_000_000: continue
            try: text=p.read_text(encoding="utf-8",errors="ignore")
            except OSError: continue
            for kind,pattern in MARKERS.items():
                for m in re.finditer(pattern,text):
                    line=text.count("\n",0,m.start())+1
                    findings.append({"kind":kind,"path":rel,"line":line})
    return {"root":str(root.resolve()),"file_count":len(files),"files":files,"languages":dict(langs.most_common()),"manifests":sorted(manifests),"likely_entrypoints":sorted(set(entrypoints)),"markers":findings}
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path",nargs="?",default=".",help="directory to inspect")
    ap.add_argument("--json",action="store_true",help="emit JSON")
    ap.add_argument("--out",help="write report to a file")
    args=ap.parse_args()
    root=Path(args.path).expanduser().resolve()
    if not root.is_dir(): ap.error(f"not a directory: {root}")
    report=scan(root)
    output=json.dumps(report,indent=2) if args.json else (
      f"# REA report: {root.name}\n\nFiles: {report['file_count']}\n\n"
      "## Language distribution\n"+ "".join(f"- {k}: {v}\n" for k,v in report["languages"].items())+
      "\n## Dependency manifests\n"+ "".join(f"- {x}\n" for x in report["manifests"])+
      "\n## Likely entrypoints\n"+ "".join(f"- {x}\n" for x in report["likely_entrypoints"])+
      "\n## Review markers (locations only)\n"+ "".join(f"- {x['kind']}: {x['path']}:{x['line']}\n" for x in report["markers"]))
    if args.out: Path(args.out).write_text(output+"\n",encoding="utf-8")
    else: print(output)
if __name__=="__main__": main()
