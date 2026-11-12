# Planner setup guidance

The checklist's progress comes from saved planner data, not page visits or guidance preferences. Existing completed sections start with their guidance hidden. Optional AI and notification guidance checks the saved connection or enabled preference before choosing its initial state; if that read fails, guidance remains available.

“Show setup guidance again” shows instructions on every setup page without changing settings or progress. Each page hides its instructions after that page confirms a new successful save. A pending or failed save does not hide them. Saves started before the restore action cannot consume the restored guidance. The manual hide and reopen controls remain available on each page.

Guidance visibility is stored in this browser's local storage under the signed-in account ID and step. It persists across navigation and reloads in this browser, and other tabs using the same browser storage receive changes. It does **not** sync across devices. If browser storage is unavailable, the current page still updates but the checklist warns that the choice may be lost on reload. No database migration is required. The stored values are only `shown`, `hidden`, and a non-secret restore revision; they contain no planner content or credentials.
