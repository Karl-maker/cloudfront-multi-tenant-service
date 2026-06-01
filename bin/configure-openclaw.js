#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const port = process.argv[2];
const configPath = "openclaw-data/config/openclaw.json";

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
config.agents.defaults.model = config.agents.defaults.model || {};
config.agents.defaults.model.primary = process.env.OPENCLAW_MODEL_OPENAI || "openai/gpt-5.5";
config.agents.defaults.model.fallbacks = config.agents.defaults.model.fallbacks || [];
config.agents.defaults.timeoutSeconds = 300;
config.agents.defaults.maxConcurrent = positiveInteger(process.env.OPENCLAW_MAX_CONCURRENT, 1);
config.agents.defaults.compaction = config.agents.defaults.compaction || {};
config.agents.defaults.compaction.model = process.env.OPENCLAW_COMPACTION_MODEL || "openai/gpt-5.5";
config.agents.defaults.compaction.memoryFlush = config.agents.defaults.compaction.memoryFlush || {};
config.agents.defaults.compaction.memoryFlush.model = process.env.OPENCLAW_COMPACTION_MODEL || "openai/gpt-5.5";
config.agents.defaults.compaction.timeoutSeconds = 300;
config.agents.defaults.heartbeat = config.agents.defaults.heartbeat || {};
config.agents.defaults.heartbeat.model = process.env.OPENCLAW_HEARTBEAT_MODEL || "openai/gpt-5.5";
config.agents.defaults.heartbeat.timeoutSeconds = 300;

config.messages = config.messages || {};
config.messages.queue = config.messages.queue || {};
config.messages.queue.mode = process.env.OPENCLAW_QUEUE_MODE || "followup";
config.messages.queue.debounceMs = positiveInteger(process.env.OPENCLAW_QUEUE_DEBOUNCE_MS, 1000);
config.messages.queue.cap = positiveInteger(process.env.OPENCLAW_QUEUE_CAP, 100);
config.messages.queue.drop = process.env.OPENCLAW_QUEUE_DROP || "summarize";
config.messages.queue.byChannel = config.messages.queue.byChannel || {};
config.messages.queue.byChannel.whatsapp = process.env.OPENCLAW_WHATSAPP_QUEUE_MODE || "followup";

config.channels = config.channels || {};
config.channels.whatsapp = config.channels.whatsapp || {};
config.channels.whatsapp.selfChatMode = true;
config.channels.whatsapp.dmPolicy = "allowlist";
// Empty allowFrom keeps inbound DMs limited to the linked owner phone, while
// OpenClaw's WhatsApp outbound resolver allows explicit sends to requested targets.
config.channels.whatsapp.allowFrom = [];
config.channels.whatsapp.accounts = config.channels.whatsapp.accounts || {};
config.channels.whatsapp.accounts.default = config.channels.whatsapp.accounts.default || {};
config.channels.whatsapp.accounts.default.selfChatMode = true;
config.channels.whatsapp.accounts.default.dmPolicy = "allowlist";
config.channels.whatsapp.accounts.default.allowFrom = [];

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
