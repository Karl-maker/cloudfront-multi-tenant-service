"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const DEFAULT_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.businessStatus",
  "places.primaryType",
  "places.types",
  "nextPageToken"
].join(",");
const DEFAULT_MAX_LEADS = 20;
const DEFAULT_SCAN_LIMIT = 60;
const DEFAULT_PAGE_SIZE = 20;
const GOOGLE_TEXT_SEARCH_LIMIT = 60;

function parseLeadArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalsIndex = body.indexOf("=");
    const rawKey = equalsIndex === -1 ? body : body.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : body.slice(equalsIndex + 1);
    const key = camelCaseArg(rawKey);

    if (inlineValue !== undefined) {
      assignArg(args, key, inlineValue);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      assignArg(args, key, argv[index + 1]);
      index += 1;
    } else {
      assignArg(args, key, true);
    }
  }

  return args;
}

function assignArg(args, key, value) {
  if (args[key] === undefined) {
    args[key] = value;
  } else if (Array.isArray(args[key])) {
    args[key].push(value);
  } else {
    args[key] = [args[key], value];
  }
}

function camelCaseArg(key) {
  return String(key || "").replace(/-([a-z0-9])/gi, (_, char) => char.toUpperCase());
}

function loadEnvFile(envFile, env = process.env) {
  if (!envFile) {
    return;
  }

  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved)) {
    return;
  }

  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (env[key] !== undefined) {
      continue;
    }
    env[key] = stripEnvQuotes(rawValue.trim());
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveApiKey(args = {}, env = process.env) {
  return (
    firstString(args.apiKey) ||
    env.GOOGLE_PLACES_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_API_KEY ||
    ""
  );
}

function buildSearchText(args = {}) {
  const explicit = firstString(args.query) || firstString(args.q);
  if (explicit) {
    return explicit.trim();
  }

  const positional = Array.isArray(args._) ? args._.join(" ").trim() : "";
  const location = firstString(args.location) || firstString(args.near);
  const industry = firstString(args.industry) || firstString(args.category) || (location ? positional : "");

  if (industry && location) {
    return `${industry.trim()} in ${location.trim()}`;
  }

  if (positional) {
    return positional;
  }

  if (industry) {
    return industry.trim();
  }

  return "";
}

function normalizeSearchOptions(args = {}) {
  const maxResults = parseBoundedInteger(
    firstValue(args.maxResults) || firstValue(args.limit),
    DEFAULT_MAX_LEADS,
    "max results",
    1,
    GOOGLE_TEXT_SEARCH_LIMIT
  );
  const scanLimit = parseBoundedInteger(
    firstValue(args.scanLimit),
    DEFAULT_SCAN_LIMIT,
    "scan limit",
    1,
    GOOGLE_TEXT_SEARCH_LIMIT
  );
  const pageSize = parseBoundedInteger(
    firstValue(args.pageSize),
    Math.min(DEFAULT_PAGE_SIZE, scanLimit),
    "page size",
    1,
    DEFAULT_PAGE_SIZE
  );
  const format = normalizeFormat(firstString(args.format) || "table");
  const fieldMask = firstString(args.fieldMask) || firstString(args.fields) || DEFAULT_FIELD_MASK;
  const textQuery = buildSearchText(args);

  if (!textQuery) {
    throw new Error("Missing search query. Pass --query, --industry/--location, or positional search text.");
  }

  assertFieldMaskCanFilterWebsites(fieldMask);

  return {
    apiKey: firstString(args.apiKey),
    endpoint: firstString(args.endpoint) || DEFAULT_ENDPOINT,
    fieldMask,
    format,
    includeClosed: Boolean(args.includeClosed),
    includedType: firstString(args.includedType) || firstString(args.placeType),
    languageCode: firstString(args.languageCode),
    location: firstString(args.location) || firstString(args.near),
    maxResults,
    pageSize,
    rankPreference: firstString(args.rankPreference),
    regionCode: firstString(args.regionCode),
    scanLimit,
    textQuery
  };
}

function normalizeFormat(format) {
  const normalized = String(format || "").toLowerCase();
  if (!["table", "json", "csv"].includes(normalized)) {
    throw new Error("Unsupported --format. Use table, json, or csv.");
  }
  return normalized;
}

function assertFieldMaskCanFilterWebsites(fieldMask) {
  const normalized = String(fieldMask || "").trim();
  if (normalized === "*") {
    return;
  }

  const fields = normalized.split(",").map((field) => field.trim());
  if (!fields.includes("places.websiteUri")) {
    throw new Error("The field mask must include places.websiteUri so the CLI can filter missing websites.");
  }
}

function parseBoundedInteger(value, fallback, label, min, max) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || String(parsed) !== String(value).trim()) {
    throw new Error(`Invalid --${label.replace(/\s+/g, "-")}: expected an integer.`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`Invalid --${label.replace(/\s+/g, "-")}: expected ${min}-${max}.`);
  }
  return parsed;
}

async function findCompaniesWithoutWebsites(args = {}) {
  const options = normalizeSearchOptions(args);
  const apiKey = options.apiKey || resolveApiKey(args, args.env || process.env);
  if (!apiKey) {
    throw new Error("Missing Google API key. Set GOOGLE_PLACES_API_KEY or pass --api-key.");
  }

  const fetchImpl = args.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available. Use Node 20+ or pass fetchImpl.");
  }

  const seenPlaceIds = new Set();
  const leads = [];
  let nextPageToken = "";
  let scanned = 0;

  while (scanned < options.scanLimit && leads.length < options.maxResults) {
    const pageSize = Math.min(options.pageSize, options.scanLimit - scanned);
    const body = buildSearchRequestBody(options, { pageSize, pageToken: nextPageToken });
    const page = await requestPlacesPage({
      apiKey,
      body,
      endpoint: options.endpoint,
      fetchImpl,
      fieldMask: options.fieldMask
    });
    const places = Array.isArray(page.places) ? page.places : [];

    scanned += places.length;
    for (const place of places) {
      const placeId = place.id || place.name || JSON.stringify(place.displayName || {});
      if (seenPlaceIds.has(placeId)) {
        continue;
      }
      seenPlaceIds.add(placeId);

      if (isLeadWithoutWebsite(place, options)) {
        leads.push(normalizePlace(place));
        if (leads.length >= options.maxResults) {
          break;
        }
      }
    }

    nextPageToken = page.nextPageToken || "";
    if (!nextPageToken || places.length === 0) {
      break;
    }
  }

  return {
    leads,
    query: options.textQuery,
    scanned,
    scanLimit: options.scanLimit
  };
}

function buildSearchRequestBody(options, { pageSize, pageToken } = {}) {
  const body = {
    textQuery: options.textQuery,
    pageSize
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }
  if (options.includedType) {
    body.includedType = options.includedType;
  }
  if (options.languageCode) {
    body.languageCode = options.languageCode;
  }
  if (options.regionCode) {
    body.regionCode = options.regionCode;
  }
  if (options.rankPreference) {
    body.rankPreference = options.rankPreference;
  }

  return body;
}

async function requestPlacesPage({ apiKey, body, endpoint, fetchImpl, fieldMask }) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask
    },
    body: JSON.stringify(body)
  });
  const text = typeof response.text === "function" ? await response.text() : "";
  const data = parseJsonResponse(text);

  if (!response.ok) {
    const detail = data?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(`Google Places request failed: ${detail}`);
  }

  return data || {};
}

function parseJsonResponse(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Google Places returned invalid JSON: ${error.message}`);
  }
}

function isLeadWithoutWebsite(place, options = {}) {
  if (!options.includeClosed && isClosedBusiness(place)) {
    return false;
  }
  return !hasWebsite(place);
}

function isClosedBusiness(place) {
  return String(place.businessStatus || "").startsWith("CLOSED");
}

function hasWebsite(place) {
  return typeof place.websiteUri === "string" && place.websiteUri.trim() !== "";
}

function normalizePlace(place) {
  return {
    name: getDisplayName(place),
    address: place.formattedAddress || "",
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || "",
    mapsUrl: place.googleMapsUri || "",
    placeId: place.id || "",
    businessStatus: place.businessStatus || "",
    primaryType: place.primaryType || "",
    types: Array.isArray(place.types) ? place.types.join("|") : "",
    website: place.websiteUri || ""
  };
}

function getDisplayName(place) {
  if (typeof place.displayName === "string") {
    return place.displayName;
  }
  return place.displayName?.text || "";
}

function formatCompanies(companies, format = "table") {
  const normalized = normalizeFormat(format);
  if (normalized === "json") {
    return JSON.stringify(companies, null, 2);
  }
  if (normalized === "csv") {
    return formatCsv(companies);
  }
  return formatTable(companies);
}

function formatCsv(companies) {
  const headers = [
    "name",
    "phone",
    "address",
    "mapsUrl",
    "placeId",
    "businessStatus",
    "primaryType",
    "types"
  ];
  const rows = [headers.join(",")];

  for (const company of companies) {
    rows.push(headers.map((header) => csvEscape(company[header] || "")).join(","));
  }

  return rows.join("\n");
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatTable(companies) {
  if (companies.length === 0) {
    return "No companies without registered Google websiteUri values found.";
  }

  const columns = [
    { key: "name", label: "Name", max: 30 },
    { key: "phone", label: "Phone", max: 18 },
    { key: "address", label: "Address", max: 42 },
    { key: "mapsUrl", label: "Google Maps", max: 42 }
  ];
  const widths = columns.map((column) => {
    const contentWidth = companies.reduce((max, company) => {
      return Math.max(max, displayCell(company[column.key] || "", column.max).length);
    }, column.label.length);
    return Math.min(column.max, contentWidth);
  });
  const header = columns.map((column, index) => padCell(column.label, widths[index])).join("  ");
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  const rows = companies.map((company) => {
    return columns
      .map((column, index) => padCell(displayCell(company[column.key] || "", column.max), widths[index]))
      .join("  ");
  });

  return [header, rule, ...rows].join("\n");
}

function displayCell(value, maxLength) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function padCell(value, width) {
  const text = String(value);
  return `${text}${" ".repeat(Math.max(0, width - text.length))}`;
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function firstString(value) {
  const first = firstValue(value);
  if (first === undefined || first === null || first === true || first === false) {
    return "";
  }
  return String(first);
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_FIELD_MASK,
  buildSearchRequestBody,
  buildSearchText,
  findCompaniesWithoutWebsites,
  formatCompanies,
  formatCsv,
  formatTable,
  hasWebsite,
  isLeadWithoutWebsite,
  loadEnvFile,
  normalizePlace,
  normalizeSearchOptions,
  parseLeadArgs,
  resolveApiKey
};
