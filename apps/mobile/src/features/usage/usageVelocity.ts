/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
export {
  assessSpendBudget,
  calculateUsageVelocity,
  usageComparisonCoverage,
  type BudgetAssessment,
  type BudgetStatus,
  type UsageVelocityMetrics,
} from "@t3tools/shared/usageVelocity";
