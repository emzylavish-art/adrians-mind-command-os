#!/usr/bin/env python3
"""Capability router for Mind Command OS agent-team manifest.

Reads a JSON task from stdin or --task, resolves the best declared specialist,
and emits a machine-readable dispatch envelope. This is routing metadata—not
an LLM execution engine. Compatible hosts execute the selected agent prompt/tool.
"""
import argparse, json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/"team"/"manifest.json"
READY={"ready"}
def load():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))
def route(task, manifest):
    requested=set(task.get("capabilities",[]))
    agents=manifest.get("agents",[])
    scored=[]
    for a in agents:
        caps=set(a.get("capabilities",[]))
        score=len(requested & caps)
        if score:
            status=a.get("status","not_implemented")
            scored.append((score, status=="ready", a))
    if not scored:
        return {"status":"blocked","result":None,"evidence":[],"limitations":["No declared specialist matched the requested capabilities."],"dispatch":None}
    scored.sort(key=lambda x:(x[0],x[1]),reverse=True)
    score, ready, agent=scored[0]
    if agent.get("status") not in {"ready","contract_defined","partial"}:
        return {"status":"blocked","result":None,"evidence":[agent["id"]],"limitations":[f"Selected specialist status is {agent.get('status')}."],"dispatch":None}
    return {"status":"ready" if agent.get("status")=="ready" else "partial","result":"Dispatch envelope created; compatible host must execute agent.","evidence":[f"team/manifest.json#{agent['id']}"],"limitations":[] if agent.get("status")=="ready" else ["Agent contract exists but implementation/runtime is not fully connected."],"dispatch":{"agent_id":agent["id"],"role":agent["role"],"entrypoint":agent.get("entrypoint"),"requires":agent.get("requires",[]),"task":task.get("task",""),"context":task.get("context",{}),"matched_capabilities":sorted(requested & set(agent.get("capabilities",[])))}}
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--task",help="task text; otherwise JSON is read from stdin")
    p.add_argument("--capability",action="append",default=[],help="capability to route (repeatable)")
    a=p.parse_args()
    try:
        payload=json.loads(sys.stdin.read()) if not a.task else {"task":a.task}
        if a.capability: payload["capabilities"]=a.capability
        if not payload.get("task"): raise ValueError("task is required")
        print(json.dumps(route(payload,load()),indent=2))
    except Exception as e:
        print(json.dumps({"status":"blocked","result":None,"evidence":[],"limitations":[str(e)],"dispatch":None}),file=sys.stdout)
        sys.exit(2)
if __name__=="__main__": main()
