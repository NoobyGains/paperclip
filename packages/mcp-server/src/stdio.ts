#!/usr/bin/env node
import { runServer } from "./index.js";
import { parseSetupArgs, runSetup } from "./setup.js";

const setupOptions = parseSetupArgs(process.argv.slice(2));
if (setupOptions) {
  void runSetup(setupOptions).then(
    (code) => {
      process.exit(code);
    },
    (error) => {
      console.error("Paperclip MCP setup failed:", error);
      process.exit(1);
    },
  );
} else {
  void runServer().catch((error) => {
    console.error("Failed to start Paperclip MCP server:", error);
    process.exit(1);
  });
}
