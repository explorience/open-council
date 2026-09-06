/**
 * Tiny stdin/stdout bridge for verify-axis-poles.py: reads a JSON array of
 * {issue, axis} pairs from stdin, calls the REAL axisLabelsFor from
 * direction-rules.ts for each (never a Python re-implementation of its
 * logic, which would drift from the source of truth the moment either file
 * changed), and writes a JSON array of {issue, axis, labels} back to
 * stdout, where `labels` is either the {expansive, restrictive} pair or
 * null. Not part of the build; run only via `npx tsx` by the verifier.
 */
import { axisLabelsFor } from "./direction-rules.js";
import type { IssueId } from "./issue-rules.js";

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const pairs: { issue: string; axis: string }[] = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const out = pairs.map(({ issue, axis }) => ({
    issue,
    axis,
    labels: axisLabelsFor(issue as IssueId, axis),
  }));
  process.stdout.write(JSON.stringify(out));
}

main();
