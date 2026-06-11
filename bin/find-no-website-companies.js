#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  findCompaniesWithoutWebsites,
  formatCompanies,
  loadEnvFile,
  normalizeSearchOptions,
  parseLeadArgs
} = require("../lib/google-places-no-website");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const args = parseLeadArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  loadEnvFile(args.envFile || process.env.ENV_FILE || ".env");
  const options = normalizeSearchOptions(args);
  const result = await findCompaniesWithoutWebsites(args);
  const output = formatCompanies(result.leads, options.format);

  if (args.out) {
    const outputPath = path.resolve(String(args.out));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${output}\n`);
    console.log(`Wrote ${outputPath}`);
    return;
  }

  console.log(output);
}

function printHelp() {
  console.log(`Find companies that do not have a website listed in Google Places.

Usage:
  find-no-website-companies --query "roofers in Tampa, FL"
  find-no-website-companies --industry "pressure washing" --location "Port of Spain" --format csv

Options:
  --query <text>              Full Google Places text search query.
  --industry <text>           Business category to search for.
  --location <text>           Location paired with --industry.
  --api-key <key>             Google Places API key. Defaults to GOOGLE_PLACES_API_KEY,
                              GOOGLE_MAPS_API_KEY, or GOOGLE_API_KEY.
  --format <table|json|csv>   Output format. Default: table.
  --limit <count>             Maximum leads to print. Default: 20, max: 60.
  --scan-limit <count>        Maximum Places results to inspect before filtering.
                              Default: 60, max: 60.
  --page-size <count>         Places page size. Default: 20, max: 20.
  --included-type <type>      Optional Google Places includedType filter.
  --region-code <code>        Optional region code passed to Places.
  --language-code <code>      Optional language code passed to Places.
  --include-closed            Include temporarily or permanently closed businesses.
  --out <file>                Write results to a file.
  --env-file <file>           Load an env file before reading the API key. Default: .env.

Examples:
  GOOGLE_PLACES_API_KEY=... find-no-website-companies --query "barbers in Austin, TX" --format json
  npm run companies:no-website -- --industry "villa rental" --location "Tobago" --format csv --out leads.csv
`);
}
