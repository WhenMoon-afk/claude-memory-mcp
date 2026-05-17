import { describe, expect, it } from "vitest";

describe("package smoke npm invocation", () => {
  it("uses the current Node executable and npm entrypoint when npm_execpath is available", async () => {
    const { getNpmInvocation } = await import("../scripts/npm-invocation.mjs");

    const invocation = getNpmInvocation({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      env: {
        npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      },
    });

    expect(invocation).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: [
        "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      ],
    });
  });

  it("falls back to npm only when npm_execpath is unavailable", async () => {
    const { getNpmInvocation } = await import("../scripts/npm-invocation.mjs");

    const invocation = getNpmInvocation({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      env: {},
    });

    expect(invocation).toEqual({
      command: "npm",
      argsPrefix: [],
    });
  });
});
