import { execFileSync } from "node:child_process";

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  git(["fetch", "--no-tags", "origin", "main"]);
  git(["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
} catch {
  fail(
    "Release blocked: current commit is not reachable from origin/main. Merge reviewed changes to main before tagging.",
  );
}

