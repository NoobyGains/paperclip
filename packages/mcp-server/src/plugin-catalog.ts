/**
 * Plugin catalog — static v1 seed from the awesome-paperclip ecosystem.
 * Each entry is typed with PluginCatalogEntry.  v2 follow-up: live-fetch
 * from the awesome-paperclip README at runtime (cached).
 */

export type PluginCategory =
  | "notifications"
  | "memory"
  | "analytics"
  | "integration"
  | "runtime"
  | "ui"
  | "identity"
  | "sync"
  | "tools"
  | "community";

export interface PluginCatalogEntry {
  /** Unique stable id — matches the npm/GitHub repo slug. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description of what the plugin does. */
  description: string;
  /** Canonical GitHub repo URL. */
  repo: string;
  /** Broad functional category. */
  category: PluginCategory;
  /** Fine-grained keyword tags. Used for recommendation matching. */
  tags: string[];
  /**
   * Whether this plugin works well with subscription-only operators (i.e. no
   * direct API billing required by the plugin itself).
   */
  subscriptionCompatible: boolean;
  /** Short prose hint shown alongside the recommendation. */
  installHint: string;
}

export const PLUGIN_CATALOG: PluginCatalogEntry[] = [
  // --- Plugins ---
  {
    id: "obsidian-paperclip",
    name: "Obsidian integration",
    description:
      "Browse, comment on, and assign Paperclip issues to AI agents directly from Obsidian.",
    repo: "https://github.com/istib/obsidian-paperclip",
    category: "ui",
    tags: ["obsidian", "notes", "ui", "desktop"],
    subscriptionCompatible: true,
    installHint: "Install via the Obsidian community plugins browser and configure with your Paperclip API key.",
  },
  {
    id: "paperclip-aperture",
    name: "Aperture (focus view)",
    description:
      "Alternative focus view with deterministic ranking of approvals and activity.",
    repo: "https://github.com/tomismeta/paperclip-aperture",
    category: "ui",
    tags: ["ui", "approvals", "focus", "board"],
    subscriptionCompatible: true,
    installHint: "See the repo README for install steps.",
  },
  {
    id: "paperclip-live-analytics-plugin",
    name: "Live analytics dashboard",
    description:
      "Live visitor analytics and dashboard for Agent Analytics integration.",
    repo: "https://github.com/Agent-Analytics/paperclip-live-analytics-plugin",
    category: "analytics",
    tags: ["analytics", "dashboard", "metrics", "monitoring"],
    subscriptionCompatible: true,
    installHint: "See the plugin's README for install steps.",
  },
  {
    id: "paperclip-plugin-acp",
    name: "ACP runtime",
    description:
      "Executes Claude Code, Codex, and Gemini CLI from chat platforms via the Agent Communication Protocol.",
    repo: "https://github.com/mvanhorn/paperclip-plugin-acp",
    category: "runtime",
    tags: ["acp", "claude", "codex", "gemini", "runtime", "execution"],
    subscriptionCompatible: true,
    installHint: "See the plugin's README for install steps.",
  },
  {
    id: "paperclip-plugin-avp",
    name: "AVP trust & reputation layer",
    description:
      "Trust and reputation layer with DID identity and EigenTrust evaluation for agents.",
    repo: "https://github.com/creatorrmode-lead/paperclip-plugin-avp",
    category: "identity",
    tags: ["trust", "identity", "did", "reputation", "security"],
    subscriptionCompatible: true,
    installHint: "See the plugin's README for install steps.",
  },
  {
    id: "paperclip-plugin-chat",
    name: "Chat copilot",
    description:
      "Interactive AI chat copilot for managing tasks, agents, and workspaces.",
    repo: "https://github.com/webprismdevin/paperclip-plugin-chat",
    category: "ui",
    tags: ["chat", "copilot", "ai", "conversation", "ui"],
    subscriptionCompatible: true,
    installHint: "See the plugin's README for install steps.",
  },
  {
    id: "paperclip-plugin-company-wizard",
    name: "Company setup wizard",
    description:
      "AI-powered company setup assistant with presets for fast onboarding.",
    repo: "https://github.com/yesterday-ai/paperclip-plugin-company-wizard",
    category: "ui",
    tags: ["setup", "wizard", "onboarding", "company", "presets"],
    subscriptionCompatible: true,
    installHint: "See the plugin's README for install steps.",
  },
  {
    id: "paperclip-plugin-discord",
    name: "Discord integration",
    description:
      "Bidirectional Discord integration: posts notifications and listens for commands.",
    repo: "https://github.com/mvanhorn/paperclip-plugin-discord",
    category: "notifications",
    tags: ["discord", "notifications", "commands", "chat"],
    subscriptionCompatible: true,
    installHint: "Set DISCORD_BOT_TOKEN and invite the bot to your server. See the plugin's README.",
  },
  {
    id: "paperclip-plugin-github-issues",
    name: "GitHub Issues sync",
    description:
      "Bidirectional GitHub Issues sync — creates Paperclip issues from GitHub issues and vice-versa.",
    repo: "https://github.com/mvanhorn/paperclip-plugin-github-issues",
    category: "integration",
    tags: ["github", "issues", "sync", "integration"],
    subscriptionCompatible: true,
    installHint: "Set GITHUB_TOKEN and configure the repo mapping. See the plugin's README.",
  },
  {
    id: "paperclip-plugin-slack",
    name: "Slack notifications",
    description:
      "Posts to Slack when issues are created, completed, or need approval.",
    repo: "https://github.com/mvanhorn/paperclip-plugin-slack",
    category: "notifications",
    tags: ["slack", "notifications", "alerts"],
    subscriptionCompatible: true,
    installHint: "Create a Slack app, set SLACK_BOT_TOKEN, and configure channels. See the plugin's README.",
  },
  {
    id: "paperclip-plugin-telegram",
    name: "Telegram notifications",
    description:
      "Sends Telegram notifications when issue events occur.",
    repo: "https://github.com/mvanhorn/paperclip-plugin-telegram",
    category: "notifications",
    tags: ["telegram", "notifications", "alerts"],
    subscriptionCompatible: true,
    installHint: "Create a Telegram bot via BotFather, set TELEGRAM_BOT_TOKEN. See the plugin's README.",
  },
  {
    id: "paperclip-plugin-writbase",
    name: "WritBase sync",
    description:
      "Bidirectional WritBase task synchronization.",
    repo: "https://github.com/Writbase/paperclip-plugin-writbase",
    category: "sync",
    tags: ["writbase", "tasks", "sync", "integration"],
    subscriptionCompatible: true,
    installHint: "See the plugin's README for install steps.",
  },
  {
    id: "paperclip-plugin-hindsight",
    name: "Hindsight (persistent memory)",
    description:
      "Persistent long-term memory for Paperclip agents — stores and retrieves context across sessions.",
    repo: "https://github.com/vectorize-io/hindsight",
    category: "memory",
    tags: ["memory", "long-term", "context", "retrieval", "rag"],
    subscriptionCompatible: true,
    installHint: "Requires a Vectorize account. See the plugin's README for setup.",
  },
  // --- Tools & utilities ---
  {
    id: "oh-my-paperclip",
    name: "oh-my-paperclip (plugin bundle)",
    description:
      "Bundled collection of Paperclip plugins — installs several popular plugins in one shot.",
    repo: "https://github.com/gsxdsm/oh-my-paperclip",
    category: "tools",
    tags: ["bundle", "plugins", "setup", "tools"],
    subscriptionCompatible: true,
    installHint: "See the repo README for the full plugin manifest and install steps.",
  },
  {
    id: "paperclip-discord-bot",
    name: "Discord community bot",
    description:
      "Discord community bot with OAuth roles and AI-powered summaries.",
    repo: "https://github.com/rekon307/paperclip-discord-bot",
    category: "community",
    tags: ["discord", "community", "bot", "oauth", "roles"],
    subscriptionCompatible: true,
    installHint: "See the repo README for invite and config steps.",
  },
  {
    id: "paperclip-mcp",
    name: "Paperclip MCP server (wizarck fork)",
    description:
      "Alternative MCP server exposing the Paperclip REST API for Claude integration.",
    repo: "https://github.com/wizarck/paperclip-mcp",
    category: "tools",
    tags: ["mcp", "claude", "integration", "api"],
    subscriptionCompatible: true,
    installHint: "See the repo README for configuration steps.",
  },
];
