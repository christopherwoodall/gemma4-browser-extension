import { WebMCPTool } from "../agent/webMcp.tsx";

export interface CapturedRequest {
  requestId: string;
  tabId: number;
  url: string;
  method: string;
  type: string;
  timeStamp: number;
  statusCode?: number;
  statusLine?: string;
  error?: string;
}

export class NetworkTrafficManager {
  private requests: Map<string, CapturedRequest> = new Map();
  private maxRequests: number = 200;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    if (typeof chrome === "undefined" || !chrome.webRequest) {
      console.warn(
        "[NetworkTrafficManager] chrome.webRequest API is not available."
      );
      return;
    }

    try {
      chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
          if (details.tabId !== -1) {
            const entry: CapturedRequest = {
              requestId: details.requestId,
              tabId: details.tabId,
              url: details.url,
              method: details.method,
              type: details.type,
              timeStamp: details.timeStamp,
            };

            this.requests.set(details.requestId, entry);

            // Maintain buffer size
            if (this.requests.size > this.maxRequests) {
              const oldestKey = this.requests.keys().next().value;
              if (oldestKey) this.requests.delete(oldestKey);
            }
          }
          return undefined;
        },
        { urls: ["<all_urls>"] }
      );

      chrome.webRequest.onCompleted.addListener(
        (details) => {
          const entry = this.requests.get(details.requestId);
          if (entry) {
            entry.statusCode = details.statusCode;
            entry.statusLine = details.statusLine;
          }
        },
        { urls: ["<all_urls>"] }
      );

      chrome.webRequest.onErrorOccurred.addListener(
        (details) => {
          const entry = this.requests.get(details.requestId);
          if (entry) {
            entry.error = details.error;
          }
        },
        { urls: ["<all_urls>"] }
      );
    } catch (error) {
      console.error("[NetworkTrafficManager] Failed to register listeners:", error);
    }
  }

  public getRecentRequests(options: {
    tabId?: number;
    filterUrl?: string;
    type?: string;
    limit?: number;
  }): CapturedRequest[] {
    const { tabId, filterUrl, type, limit = 20 } = options;
    const all = Array.from(this.requests.values());

    // Most recent first
    all.sort((a, b) => b.timeStamp - a.timeStamp);

    const filtered = all.filter((req) => {
      if (tabId !== undefined && tabId !== -1 && req.tabId !== tabId) {
        return false;
      }
      if (filterUrl && !req.url.toLowerCase().includes(filterUrl.toLowerCase())) {
        return false;
      }
      if (type && type.toLowerCase() !== "all") {
        const reqType = req.type.toLowerCase();
        const filterType = type.toLowerCase();
        if (filterType === "xhr" || filterType === "fetch" || filterType === "api") {
          if (reqType !== "xmlhttprequest" && reqType !== "other") {
            return false;
          }
        } else if (!reqType.includes(filterType)) {
          return false;
        }
      }
      return true;
    });

    return filtered.slice(0, Math.min(limit, 50));
  }

  public clear() {
    this.requests.clear();
  }
}

let networkTrafficManager: NetworkTrafficManager | null = null;

export const getNetworkTrafficManager = (): NetworkTrafficManager => {
  if (!networkTrafficManager) {
    networkTrafficManager = new NetworkTrafficManager();
  }
  return networkTrafficManager;
};

export const createCaptureWebTrafficTool = (
  manager: NetworkTrafficManager
): WebMCPTool => ({
  name: "capture_web_traffic",
  description:
    "Capture and inspect recent network requests made by the active browser tab (or across tabs). " +
    "Can filter by URL keyword (filterUrl), resource type (e.g. 'xmlhttprequest', 'fetch', 'script', 'stylesheet', 'all'), and limit.",
  inputSchema: {
    type: "object",
    properties: {
      filterUrl: {
        type: "string",
        description:
          "Optional substring to filter requested URLs (e.g. 'api', 'v1', 'graphql').",
      },
      type: {
        type: "string",
        description:
          "Optional resource type filter: 'xmlhttprequest', 'fetch', 'script', 'stylesheet', 'image', or 'all' (default: 'all').",
      },
      limit: {
        type: "number",
        description: "Maximum number of recent requests to return (default: 20, max: 50).",
      },
    },
    required: [],
  },
  execute: async (args) => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const tabId = tab?.id;
      const filterUrl = args.filterUrl as string | undefined;
      const type = args.type as string | undefined;
      const limit = typeof args.limit === "number" ? args.limit : 20;

      const results = manager.getRecentRequests({
        tabId,
        filterUrl,
        type,
        limit,
      });

      if (results.length === 0) {
        return (
          `No network requests captured for the current tab matching filters ` +
          `(filterUrl: ${filterUrl ?? "none"}, type: ${type ?? "all"}).`
        );
      }

      let output = `Captured ${results.length} recent network request(s) for tab "${tab?.title ?? tabId}":\n\n`;
      results.forEach((req, idx) => {
        const status = req.error
          ? `[ERROR: ${req.error}]`
          : req.statusCode
            ? `[HTTP ${req.statusCode}]`
            : "[In-flight / pending]";
        output += `${idx + 1}. ${req.method} ${req.url}\n   Type: ${req.type} | Status: ${status}\n\n`;
      });

      return output.trim();
    } catch (error: any) {
      console.error("[tool:capture_web_traffic] error:", error);
      return `Error capturing web traffic: ${error?.message || String(error)}`;
    }
  },
});
