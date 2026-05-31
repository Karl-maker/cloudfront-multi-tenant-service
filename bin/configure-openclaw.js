#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const port = process.argv[2];
const configPath = "openclaw-data/config/openclaw.json";

if (!fs.existsSync(configPath)) {
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.gateway = config.gateway || {};
config.gateway.controlUi = config.gateway.controlUi || {};

const origins = new Set(config.gateway.controlUi.allowedOrigins || []);
for (const origin of [`http://localhost:${port}`, `http://127.0.0.1:${port}`]) {
  origins.add(origin);
}

config.gateway.controlUi.allowedOrigins = [...origins];

config.diagnostics = config.diagnostics || {};
config.diagnostics.stuckSessionWarnMs = 90000;
config.diagnostics.stuckSessionAbortMs = 180000;

config.session = config.session || {};
config.session.dmScope = "per-peer";

config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.timeoutSeconds = 300;
config.agents.defaults.compaction = config.agents.defaults.compaction || {};
config.agents.defaults.compaction.timeoutSeconds = 300;
config.agents.defaults.heartbeat = config.agents.defaults.heartbeat || {};
config.agents.defaults.heartbeat.timeoutSeconds = 300;

config.channels = config.channels || {};
config.channels.whatsapp = config.channels.whatsapp || {};
config.channels.whatsapp.selfChatMode = true;
config.channels.whatsapp.dmPolicy = config.channels.whatsapp.dmPolicy || "allowlist";
config.channels.whatsapp.allowFrom = config.channels.whatsapp.allowFrom || ["18687422549"];
config.channels.whatsapp.accounts = config.channels.whatsapp.accounts || {};
config.channels.whatsapp.accounts.default = config.channels.whatsapp.accounts.default || {};
config.channels.whatsapp.accounts.default.selfChatMode = true;
config.channels.whatsapp.accounts.default.dmPolicy =
  config.channels.whatsapp.accounts.default.dmPolicy || "allowlist";
config.channels.whatsapp.accounts.default.allowFrom =
  config.channels.whatsapp.accounts.default.allowFrom || ["18687422549"];

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
