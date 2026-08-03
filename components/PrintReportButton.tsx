'use client';

/** Opens the browser print dialog, which includes "Save as PDF". */
export function PrintReportButton() {
  return (
    <button className="print-report" type="button" onClick={() => window.print()}>
      <span aria-hidden>⇩</span>
      Export to PDF
    </button>
  );
}
