'use client';

/**
 * PDF export via the browser's print pipeline (FR-G1). Using print rather than a
 * PDF library keeps the exported document identical to what is on screen and
 * avoids shipping a renderer for one screen.
 */
export function PrintButton() {
  return (
    <button className="btn primary" onClick={() => window.print()}>
      Export to PDF
    </button>
  );
}
