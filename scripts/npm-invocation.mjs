export function getNpmInvocation({
  execPath = process.execPath,
  env = process.env,
} = {}) {
  if (env.npm_execpath) {
    return {
      command: execPath,
      argsPrefix: [env.npm_execpath],
    };
  }

  return {
    command: "npm",
    argsPrefix: [],
  };
}

export function runNpm(args, options = {}) {
  const { execFileSync, ...execOptions } = options;
  if (typeof execFileSync !== "function") {
    throw new TypeError("runNpm requires execFileSync");
  }

  const invocation = getNpmInvocation();
  return execFileSync(
    invocation.command,
    [...invocation.argsPrefix, ...args],
    execOptions,
  );
}
