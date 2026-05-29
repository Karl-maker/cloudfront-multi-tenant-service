"use strict";

const https = require("node:https");

function buildCnameRecord({ name, value, ttl = 600 }) {
  if (!name || typeof name !== "string") {
    throw new Error("CNAME record name is required.");
  }
  if (!value || typeof value !== "string") {
    throw new Error("CNAME value is required.");
  }

  return {
    type: "CNAME",
    name: name.trim(),
    data: value.trim().replace(/\.$/, ""),
    ttl: Number(ttl)
  };
}

function buildGoDaddyPatchRequest({ domain, apiKey, apiSecret, record }) {
  if (!domain) {
    throw new Error("GoDaddy domain is required.");
  }
  if (!apiKey || !apiSecret) {
    throw new Error("GODADDY_API_KEY and GODADDY_API_SECRET are required.");
  }

  const body = JSON.stringify([record]);

  return {
    hostname: "api.godaddy.com",
    path: `/v1/domains/${encodeURIComponent(domain)}/records`,
    method: "PATCH",
    headers: {
      Authorization: `sso-key ${apiKey}:${apiSecret}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    },
    body
  };
}

function addGoDaddyRecord({ domain, apiKey, apiSecret, record }) {
  const request = buildGoDaddyPatchRequest({ domain, apiKey, apiSecret, record });

  return new Promise((resolve, reject) => {
    const req = https.request(request, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body });
        } else {
          reject(new Error(`GoDaddy API failed with ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("error", reject);
    req.write(request.body);
    req.end();
  });
}

function describeCname({ domain, record }) {
  return `${record.name}.${domain} CNAME ${record.data} TTL ${record.ttl}`;
}

module.exports = {
  addGoDaddyRecord,
  buildCnameRecord,
  buildGoDaddyPatchRequest,
  describeCname
};
