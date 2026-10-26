"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type DefectMetric = {
  input_mode: string;
  defect_type: string;
  rule_id: string;
  positive_count: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
};

type MissedItem = {
  input_mode: string;
  application_number: string;
  defect_type: string;
  rule_id: string;
  why: string;
};

type RedTeamItem = {
  attempt_id: string;
  attack: string;
  target_defect: string;
  result: string;
  indicator_emitted: boolean;
};

type EvaluationReport = {
  status?: "empty";
  generated_at?: string;
  dataset?: { name: string; records: number; modes: string[]; synthetic_only: boolean };
  validation?: Array<{
    input_mode: string;
    defect_metrics: DefectMetric[];
    decoy_false_positive_rate: {
      decoy_count: number;
      flagged_count: number;
      false_positive_rate: number | null;
    };
  }>;
  what_we_miss?: MissedItem[];
  red_team?: RedTeamItem[];
};

type AgreementStat = { ruleId: string; accepted: number; dismissed: number };

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function collectDefects(report: EvaluationReport) {
  const byType = new Map<string, { ruleId: string; tp: number; fp: number; fn: number }>();
  for (const scenario of report.validation ?? []) {
    for (const metric of scenario.defect_metrics) {
      const value = byType.get(metric.defect_type) ?? {
        ruleId: metric.rule_id,
        tp: 0,
        fp: 0,
        fn: 0,
      };
      value.tp += metric.tp;
      value.fp += metric.fp;
      value.fn += metric.fn;
      byType.set(metric.defect_type, value);
    }
  }
  return [...byType.entries()].map(([type, value]) => {
    const total = value.tp + value.fn;
    const recall = total ? value.tp / total : null;
    const precisionTotal = value.tp + value.fp;
    const precision = precisionTotal ? value.tp / precisionTotal : null;
    const status = value.tp === 0 ? "Missed" : value.fn === 0 ? "Caught" : "Sometimes";
    return { type, ...value, recall, precision, status };
  });
}

export function MetricsWorkspace() {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(true);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [agreement, setAgreement] = useState<AgreementStat[]>([]);
  const [agreementLoading, setAgreementLoading] = useState(true);
  const [agreementError, setAgreementError] = useState("");

  const loadBenchmark = useCallback(async () => {
    setBenchmarkLoading(true);
    setBenchmarkError("");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setBenchmarkError("Supabase is not configured.");
      setBenchmarkLoading(false);
      return;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      setBenchmarkError("Sign in to view the synthetic benchmark.");
      setBenchmarkLoading(false);
      return;
    }
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
    try {
      const response = await fetch(`${apiUrl}/eval/metrics`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Benchmark results could not be loaded.");
      }
      setReport(await response.json() as EvaluationReport);
    } catch (cause) {
      setBenchmarkError(cause instanceof Error ? cause.message : "Benchmark results could not be loaded.");
    } finally {
      setBenchmarkLoading(false);
    }
  }, []);

  const loadAgreement = useCallback(async () => {
    setAgreementLoading(true);
    setAgreementError("");
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAgreementError("Supabase is not configured.");
      setAgreementLoading(false);
      return;
    }
    const { data: reviews, error: reviewsError } = await supabase
      .from("reviews")
      .select("action, finding_id");
    if (reviewsError) {
      setAgreementError(reviewsError.message);
      setAgreementLoading(false);
      return;
    }
    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("finding_id, rule_id");
    if (findingsError) {
      setAgreementError(findingsError.message);
      setAgreementLoading(false);
      return;
    }
    const ruleByFinding = new Map((findings ?? []).map((item) => [item.finding_id, item.rule_id]));
    const grouped = new Map<string, AgreementStat>();
    for (const review of reviews ?? []) {
      if (review.action !== "accept" && review.action !== "dismiss") continue;
      const ruleId = ruleByFinding.get(review.finding_id);
      if (!ruleId) continue;
      const stat = grouped.get(ruleId) ?? { ruleId, accepted: 0, dismissed: 0 };
      if (review.action === "accept") stat.accepted += 1;
      else stat.dismissed += 1;
      grouped.set(ruleId, stat);
    }
    setAgreement([...grouped.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId)));
    setAgreementLoading(false);
  }, []);

  useEffect(() => {
    void loadBenchmark();
    void loadAgreement();
  }, [loadAgreement, loadBenchmark]);

  const defectRows = report ? collectDefects(report) : [];
  const decoyCount = (report?.validation ?? []).reduce((total, row) => total + row.decoy_false_positive_rate.decoy_count, 0);
  const decoyFlagged = (report?.validation ?? []).reduce((total, row) => total + row.decoy_false_positive_rate.flagged_count, 0);
  const misses = report?.what_we_miss ?? [];
  const redTeam = report?.red_team ?? [];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 20px" }}>
      <header style={{ marginBottom: 20 }}>
        <p className="section-label">SYNTHETIC EVALUATION AND LIVE REVIEW</p>
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Metrics</h1>
        <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
          Benchmark results use the generated synthetic evaluation report. Live review counts come from recorded officer actions.
        </p>
      </header>

      <section className="metrics-panel" style={{ marginBottom: 20 }}>
        <div className="panel-heading">
          <div>
            <p className="section-label">SECTION 1</p>
            <h2>Benchmark on synthetic dataset</h2>
          </div>
          <button className="review-secondary" onClick={() => void loadBenchmark()} disabled={benchmarkLoading}>
            {benchmarkLoading ? "Loading…" : "Retry"}
          </button>
        </div>
        {benchmarkLoading ? <p>Loading benchmark…</p> : benchmarkError ? (
          <p className="review-error" role="alert">{benchmarkError}</p>
        ) : !report || report.status === "empty" || !report.dataset ? (
          <p className="review-empty">No data yet. Generate the evaluation report to populate this section.</p>
        ) : (
          <>
            <p className="muted">
              {report.dataset.name} · {report.dataset.records} synthetic applications · {report.dataset.modes.join(", ")} ·
              {" "}generated {report.generated_at ? new Date(report.generated_at).toLocaleString() : "time unavailable"}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="metrics-table">
                <thead><tr><th>Flaw type</th><th>Rule</th><th>Status</th><th>Caught / missed</th><th>Precision</th><th>Recall</th></tr></thead>
                <tbody>
                  {defectRows.map((row) => (
                    <tr key={row.type}>
                      <td>{row.type.replaceAll("_", " ")}</td>
                      <td>{row.ruleId}</td>
                      <td>{row.status}</td>
                      <td>{row.tp} / {row.fn}</td>
                      <td>{percent(row.precision)}</td>
                      <td>{percent(row.recall)}</td>
                    </tr>
                  ))}
                  {!defectRows.length && <tr><td colSpan={6}>No flaw-type results in this report.</td></tr>}
                </tbody>
              </table>
            </div>
            <p>
              Decoy false-positive rate: {decoyCount ? `${percent(decoyFlagged / decoyCount)} (${decoyFlagged}/${decoyCount})` : "No data yet"}
            </p>
            <div className="metrics-detail-grid">
              <section>
                <h3>What we miss</h3>
                {misses.length ? <ul>{misses.map((item, index) => (
                  <li key={`${item.application_number}-${item.rule_id}-${index}`}>
                    {item.application_number} · {item.input_mode} · {item.defect_type}: {item.why}
                  </li>
                ))}</ul> : <p>No missed cases reported.</p>}
              </section>
              <section>
                <h3>We tried to fool it</h3>
                {redTeam.length ? <ul>{redTeam.map((item) => (
                  <li key={item.attempt_id}>{item.attempt_id} · {item.result} · {item.target_defect}: {item.attack}</li>
                ))}</ul> : <p>No red-team results reported.</p>}
              </section>
            </div>
          </>
        )}
      </section>

      <section className="metrics-panel">
        <div className="panel-heading">
          <div><p className="section-label">SECTION 2</p><h2>Live officer agreement</h2></div>
          <button className="review-secondary" onClick={() => void loadAgreement()} disabled={agreementLoading}>
            {agreementLoading ? "Loading…" : "Retry"}
          </button>
        </div>
        <p className="muted">Accepted vs dismissed rates by rule, based on recorded officer reviews.</p>
        {agreementLoading ? <p>Loading review actions…</p> : agreementError ? (
          <p className="review-error" role="alert">{agreementError}</p>
        ) : agreement.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="metrics-table">
              <thead><tr><th>Rule</th><th>Accepted</th><th>Dismissed</th><th>Accepted rate</th><th>Dismissed rate</th></tr></thead>
              <tbody>{agreement.map((row) => {
                const total = row.accepted + row.dismissed;
                return <tr key={row.ruleId}>
                  <td>{row.ruleId}</td>
                  <td>{row.accepted}</td>
                  <td>{row.dismissed}</td>
                  <td>{percent(row.accepted / total)}</td>
                  <td>{percent(row.dismissed / total)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : <p className="review-empty">No data yet.</p>}
      </section>
    </div>
  );
}
