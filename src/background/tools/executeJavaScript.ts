import { WebMCPTool } from "../agent/webMcp.tsx";

export const executeJavaScriptTool: WebMCPTool = {
  name: "execute_javascript",
  description:
    "Execute JavaScript code directly in the active browser tab and return the result. " +
    "Useful for interacting with webpage DOM, clicking buttons, submitting forms, inspecting JavaScript variables, " +
    "or extracting specific custom data. Asynchronous code with await or Promises is supported.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "The JavaScript code to execute on the active webpage. For statements returning a value, the evaluated result is returned.",
      },
    },
    required: ["code"],
  },
  execute: async (args) => {
    const code = args.code as string;
    if (!code || typeof code !== "string") {
      return "Error: 'code' argument must be a non-empty string.";
    }

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        return "Error: No active tab found.";
      }

      if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
        return `Error: Cannot execute JavaScript on non-web page (${tab.url || "about:blank"}).`;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (scriptSource: string) => {
          try {
            const trimmed = scriptSource.trim();
            let evaluationResult: any;

            // Handle return statements or top-level await by wrapping in an async function
            if (trimmed.startsWith("return ") || trimmed.includes("await ")) {
              const AsyncFunction = Object.getPrototypeOf(async function () {})
                .constructor;
              const asyncFn = new AsyncFunction(scriptSource);
              evaluationResult = await asyncFn();
            } else {
              evaluationResult = (0, eval)(scriptSource);
              if (evaluationResult instanceof Promise) {
                evaluationResult = await evaluationResult;
              }
            }

            if (evaluationResult === undefined) {
              return "undefined";
            }

            if (evaluationResult === null) {
              return "null";
            }

            if (typeof evaluationResult === "object") {
              try {
                return JSON.stringify(evaluationResult, null, 2);
              } catch {
                return String(evaluationResult);
              }
            }

            return String(evaluationResult);
          } catch (error: any) {
            return `JavaScript execution error: ${error?.message || String(error)}`;
          }
        },
        args: [code],
      });

      const scriptOutput = results?.[0]?.result ?? "No output returned.";
      const maxOutputLength = 8000;
      if (typeof scriptOutput === "string" && scriptOutput.length > maxOutputLength) {
        return (
          scriptOutput.slice(0, maxOutputLength) +
          `\n... [Output truncated. Total characters: ${scriptOutput.length}]`
        );
      }

      return scriptOutput;
    } catch (error: any) {
      console.error("[tool:execute_javascript] execution failed:", error);
      return `Error executing script on tab: ${error?.message || String(error)}`;
    }
  },
};
