// The path table a data-router app keeps its routes in. The route table refers
// to `paths.app.reports.path` rather than writing the string, which is exactly
// what discovery could not follow before WP-28.
export const paths = {
  home: { path: '/' },
  app: {
    root: { path: '/app' },
    reports: { path: 'reports' },
    report: { path: 'reports/:reportId' },
  },
} as const;
