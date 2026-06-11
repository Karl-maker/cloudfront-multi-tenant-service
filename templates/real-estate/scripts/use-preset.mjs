import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const presetsDir = join(projectRoot, "content/presets");
const presetNames = readdirSync(presetsDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => basename(file, ".json"))
  .sort();

const requested = process.argv[2];

if (!requested || requested === "--list") {
  console.log("Available presets:");
  for (const name of presetNames) {
    console.log(`- ${name}`);
  }
  process.exit(requested ? 0 : 1);
}

const presetPath = join(presetsDir, `${requested}.json`);

if (!existsSync(presetPath)) {
  console.error(`Unknown preset "${requested}".`);
  console.error(`Available presets: ${presetNames.join(", ")}`);
  process.exit(1);
}

const publicConfigPath = join(projectRoot, "public/site.config.json");

copyFileSync(presetPath, publicConfigPath);
console.log(`Applied preset "${requested}" to public/site.config.json for local runtime preview.`);
