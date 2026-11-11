import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRAILLE_PIXEL_HEIGHT,
  BRAILLE_PIXEL_WIDTH,
  brailleArtLines,
  brailleFaceLines,
} from "../src/braille.ts";
import { FACES, isMood } from "../src/face.ts";

test("braille renderer produces aligned animated art for every mood", () => {
  for (const mood of Object.keys(FACES)) {
    assert.ok(isMood(mood));
    const first = brailleFaceLines(mood, 0);
    const second = brailleFaceLines(mood, 1);
    assert.equal(first.length, BRAILLE_PIXEL_HEIGHT / 4 + 3);
    assert.equal(brailleArtLines(mood, 0).length, 8);
    assert.ok(BRAILLE_PIXEL_WIDTH >= 48);
    assert.equal(new Set(first.map((line) => line.length)).size, 1);
    assert.match(first.join("\n"), /[\u2801-\u28ff]/u);
    assert.notDeepEqual(first.slice(2, -1), second.slice(2, -1));
  }
});
