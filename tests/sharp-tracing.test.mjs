import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Run after `next build`: a successful compile does not prove that the native
// libraries required at runtime made it into the serverless deployment traces.
const imgRoot = path.resolve("node_modules/@img");
const libraries = readdirSync(imgRoot)
  .filter((name) => name.startsWith("sharp-libvips-"))
  .flatMap((name) => {
    const libDir = path.join(imgRoot, name, "lib");
    return readdirSync(libDir)
      .filter((file) => /^libvips.*(?:\.dylib|\.so(?:\..*)?)$/.test(file))
      .map((file) => path.join(libDir, file));
  });

test("the installed Sharp packages contain native libvips libraries", () => {
  assert.ok(libraries.length > 0, "No libvips shared libraries installed (expected macOS or Linux).");
});

for (const route of [
  "inspect/[id]/generate/page",
  "inspect/[id]/generate/download/route",
  "review/[token]/page",
  "review/[token]/download/route",
]) {
  test(`${route} bundles the libvips shared libraries`, () => {
    const tracePath = path.resolve(".next/server/app", `${route}.js.nft.json`);
    const trace = JSON.parse(readFileSync(tracePath, "utf8"));
    const included = new Set(trace.files.map((file) => path.resolve(path.dirname(tracePath), file)));
    for (const library of libraries) {
      assert.ok(included.has(library), `Missing runtime dependency: ${path.relative(process.cwd(), library)}`);
    }
  });
}
