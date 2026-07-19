#!/usr/bin/env node
import { EXIT_INVALID, MaintenanceError, executeMaintenance, loadPolicy } from "./upstream-maintenance-lib.mjs";

function usage() {
  return "Usage: node scripts/upstream-maintenance.mjs [--repo <path>] [--policy <path>] [--output-dir <path>] [--validate-policy]";
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (argument === "--validate-policy") {
      options.validatePolicy = true;
      continue;
    }
    if (!["--repo", "--policy", "--output-dir"].includes(argument)) throw new MaintenanceError(`Unknown argument ${argument}.`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new MaintenanceError(`${argument} requires a value.`);
    options[argument.slice(2).replaceAll("-", "")] = value;
    index += 1;
  }
  return options;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
  } else if (options.validatePolicy) {
    loadPolicy(options.policy ?? "maintenance/upstream-policy.json");
    process.stdout.write("upstream maintenance policy is valid\n");
  } else {
    const result = executeMaintenance({ repo: options.repo, policyPath: options.policy, outputDir: options.outputdir });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, outputs: result.outputs }, null, 2)}\n`);
    process.exitCode = result.exitCode;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`upstream maintenance validation failed: ${message}\n`);
  process.exitCode = EXIT_INVALID;
}
