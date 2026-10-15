#!/usr/bin/env node
// Derive wordmark-dark.svg and wordmark-light.svg from newLogo.svg.
// Strips the embedded navy background rectangle (first subpath of line 5)
// and produces two color variants for light/dark backgrounds.

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "public", "img", "newLogo.svg");
const OUT_DARK = path.resolve(__dirname, "..", "public", "img", "wordmark-dark.svg");
const OUT_LIGHT = path.resolve(__dirname, "..", "public", "img", "wordmark-light.svg");

let svg = fs.readFileSync(SRC, "utf8");

const BG_SUBPATH = "M0 21.25 l0 -21.25 85 0 85 0 0 21.25 0 21.25 -85 0 -85 0 0 -21.25z m";
if (!svg.includes(BG_SUBPATH)) {
  console.error("FAIL: expected bg subpath not found in source");
  process.exit(1);
}

function writeVariant(textColor, file) {
  let out = svg;

  // 1) Strip the background rectangle subpath. Prepend an absolute moveto
  //    "M0 21.25" (no draw commands) so the pen lands where the closed rect
  //    left it. The first glyph's relative "m 142.21 6.54" then resolves to
  //    the same absolute coordinate (142.21, 27.79) it had in the source,
  //    keeping the type vertically centered in the 170×43 viewBox.
  out = out.replace(BG_SUBPATH, "M0 21.25 m");

  // 2) Recolor every text-bearing group so the type renders in `textColor`.
  //    Both the original navy (#242e3d) and white (#fffffe) groups become
  //    the same target color; overlapping same-color strokes merge cleanly.
  out = out
    .replace(/<g fill="#242e3d">/g, `<g fill="${textColor}">`)
    .replace(/<g fill="#fffffe">/g, `<g fill="${textColor}">`);

  fs.writeFileSync(file, out, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), file)} (${out.length} bytes)`);
}

writeVariant("#242E3D", OUT_DARK);
writeVariant("#FFFFFF", OUT_LIGHT);
