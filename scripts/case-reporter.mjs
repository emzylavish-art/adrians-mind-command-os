import { relative } from "node:path";
export default async function* report(events) {
  for await (const { type, data } of events) {
    if (type !== "test:pass" && type !== "test:fail") continue;
    if (!data.file || data.details?.type === "suite") continue;
    yield JSON.stringify({
      file: relative(process.cwd(), data.file),
      line: data.line,
      name: data.name,
      result: data.skip ? "skip" : data.todo ? "todo" : type === "test:pass" ? "pass" : "fail",
    }) + "\n";
  }
}
