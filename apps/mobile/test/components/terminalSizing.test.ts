import assert from "node:assert/strict";
import test from "node:test";

import { widthFittedFontSize } from "../../components/terminalSizing.js";

test("enlarges to the available width while retaining every column", () => {
  assert.equal(
    widthFittedFontSize({
      minimumFontSize: 9,
      measuredFontSize: 9,
      frameColumns: 120,
      proposedColumns: 160,
    }),
    12,
  );
});

test("rounds down to a whole-pixel size that does not overrun the width", () => {
  assert.equal(
    widthFittedFontSize({
      minimumFontSize: 9,
      measuredFontSize: 9,
      frameColumns: 120,
      proposedColumns: 159,
    }),
    11,
  );
});

test("keeps the base size when the frame exactly fits", () => {
  assert.equal(
    widthFittedFontSize({
      minimumFontSize: 9,
      measuredFontSize: 9,
      frameColumns: 120,
      proposedColumns: 120,
    }),
    9,
  );
});

test("never shrinks below the base size on a narrow viewport", () => {
  assert.equal(
    widthFittedFontSize({
      minimumFontSize: 9,
      measuredFontSize: 9,
      frameColumns: 120,
      proposedColumns: 96,
    }),
    9,
  );
});

test("safe-area and exit-strip width reductions produce a smaller enlargement", () => {
  const unobstructed = widthFittedFontSize({
    minimumFontSize: 9,
    measuredFontSize: 9,
    frameColumns: 120,
    proposedColumns: 168,
  });
  const safeViewport = widthFittedFontSize({
    minimumFontSize: 9,
    measuredFontSize: 9,
    frameColumns: 120,
    proposedColumns: 148,
  });

  assert.equal(unobstructed, 12);
  assert.equal(safeViewport, 11);
});

test("falls back to the base size when xterm cannot propose dimensions", () => {
  assert.equal(
    widthFittedFontSize({
      minimumFontSize: 9,
      measuredFontSize: 9,
      frameColumns: 120,
      proposedColumns: Number.NaN,
    }),
    9,
  );
});

test("can reduce an earlier fullscreen fit after the viewport narrows", () => {
  assert.equal(
    widthFittedFontSize({
      minimumFontSize: 9,
      measuredFontSize: 12,
      frameColumns: 120,
      proposedColumns: 110,
    }),
    11,
  );
});
