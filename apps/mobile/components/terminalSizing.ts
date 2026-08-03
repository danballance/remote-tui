/** Inputs used to estimate a larger xterm font without changing its columns. */
export interface WidthFitInput {
  /** Smallest font size the terminal may use. */
  minimumFontSize: number;
  /** Font size at which the fit add-on measured the available columns. */
  measuredFontSize: number;
  /** Columns in the captured tmux frame. */
  frameColumns: number;
  /** Columns the safe viewport can display at the base font size. */
  proposedColumns: number;
}

/**
 * Estimates the largest whole-pixel font that can retain every frame column.
 * The caller verifies the estimate against xterm's rendered cell measurements.
 */
export function widthFittedFontSize({
  minimumFontSize,
  measuredFontSize,
  frameColumns,
  proposedColumns,
}: WidthFitInput): number {
  if (
    !Number.isFinite(minimumFontSize) ||
    !Number.isFinite(measuredFontSize) ||
    !Number.isFinite(frameColumns) ||
    !Number.isFinite(proposedColumns) ||
    minimumFontSize <= 0 ||
    measuredFontSize <= 0 ||
    frameColumns <= 0 ||
    proposedColumns <= 0
  ) {
    return minimumFontSize;
  }

  const fittedFontSize = Math.floor(
    (measuredFontSize * proposedColumns) / frameColumns,
  );
  return Math.max(minimumFontSize, fittedFontSize);
}
