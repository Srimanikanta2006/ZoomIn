"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { ComponentType, MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AlertTriangle, Building2, FileText, Fingerprint, MapPin, Network, RotateCcw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { GraphNodeType, TrustGraphEdge, TrustGraphNode, TrustGraphResponse } from "@/lib/graph-models";
import { OfficerShell } from "@/components/officer-shell";
import { normalizeRole, type Role } from "@/lib/roles";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";

type GraphNodeData = TrustGraphNode & Record<string, unknown>;
type GraphLinkData = Omit<TrustGraphEdge, "source" | "target"> & Record<string, unknown> & {
  source: string | GraphNodeData;
  target: string | GraphNodeData;
};
type GraphProps = ForceGraphProps<GraphNodeData, GraphLinkData> & {
  ref?: MutableRefObject<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>;
};
const ForceGraph = dynamic<GraphProps>(
  () => import("react-force-graph-2d").then((module) => module.default as unknown as ComponentType<GraphProps>),
  { ssr: false },
);

const types: { id: GraphNodeType | "all"; label: string; color: string; icon: typeof Building2 }[] = [
  { id: "all", label: "All records", color: "#032448", icon: Network },
  { id: "institution", label: "Institutions", color: "#032448", icon: Building2 },
  { id: "faculty", label: "Faculty IDs", color: "#456894", icon: Fingerprint },
  { id: "document", label: "Documents", color: "#a85a00", icon: FileText },
  { id: "address", label: "Addresses", color: "#263748", icon: MapPin },
  { id: "signatory", label: "Signatories", color: "#687583", icon: Fingerprint },
];
const nodeColor: Record<GraphNodeType, string> = {
  institution: "#032448", application: "#8aa0bd", document: "#a85a00", faculty: "#456894", address: "#263748", signatory: "#687583",
};
const edgeColor: Record<string, string> = {
  shared_faculty: "#b3261e", shared_address: "#8c5000", duplicate_document: "#b3261e", shared_signatory: "#7a8795",
};

function idOf(value: string | TrustGraphNode) { return typeof value === "string" ? value : value.id; }

export function TrustGraphWorkspace() {
  const supabase = getSupabase();
  const graphRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [caseHref, setCaseHref] = useState("/officer");
  const [graph, setGraph] = useState<TrustGraphResponse | null>(null);
  const [selected, setSelected] = useState<TrustGraphNode | null>(null);
  const [filter, setFilter] = useState<GraphNodeType | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let live = true;
    async function loadRole() {
      if (!user || !supabase) { setRole(null); return; }
      const claim = user.app_metadata?.role;
      const claimedRole = normalizeRole(claim);
      if (claimedRole) { setRole(claimedRole); return; }
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      if (live) setRole(normalizeRole(data?.role));
    }
    void loadRole();
    return () => { live = false; };
  }, [user, supabase]);

  useEffect(() => {
    let live = true;
    async function loadCaseLink() {
      if (!supabase || !user) return;
      const { data } = await supabase.from("applications").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (live && data?.id) setCaseHref(`/case/${data.id}`);
    }
    void loadCaseLink();
    return () => { live = false; };
  }, [user, supabase]);

  useEffect(() => {
    let live = true;
    async function loadGraph() {
      if (!user || !supabase) { setGraph(null); setLoading(false); return; }
      setLoading(true);
      setError("");
      const { data } = await supabase.auth.getSession();
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860").replace(/\/$/, "");
      try {
        const response = await fetch(`${apiUrl}/graph`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({})) as { detail?: string };
          throw new Error(detail.detail || "The trust graph could not be loaded.");
        }
        const result = await response.json() as TrustGraphResponse;
        if (live) setGraph(result);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "The trust graph could not be loaded.");
      } finally { if (live) setLoading(false); }
    }
    void loadGraph();
    return () => { live = false; };
  }, [user, supabase]);

  const graphData = useMemo(() => {
    const query = search.trim().toLowerCase();
    const nodes = (graph?.nodes ?? []).filter((node) => {
      const matchesType = filter === "all" || node.type === filter;
      const matchesText = !query || `${node.label} ${node.institution_name ?? ""} ${node.application_id ?? ""}`.toLowerCase().includes(query);
      return matchesType && matchesText;
    });
    const visible = new Set(nodes.map((node) => node.id));
    const links = (graph?.edges ?? []).filter((edge) => visible.has(idOf(edge.source)) && visible.has(idOf(edge.target)));
    return {
      nodes: nodes as unknown as GraphNodeData[],
      links: links.map((edge) => ({ ...edge, source: idOf(edge.source), target: idOf(edge.target) })) as unknown as GraphLinkData[],
    };
  }, [graph, filter, search]);

  const selectedEdges = useMemo(() => graphData.links.filter((edge) => idOf(edge.source) === selected?.id || idOf(edge.target) === selected?.id), [graphData.links, selected]);
  const selectedAlerts = useMemo(() => graph?.alerts.filter((finding) => finding.application_id === selected?.application_key) ?? [], [graph, selected]);

  const paintNode = useCallback((rawNode: TrustGraphNode, context: CanvasRenderingContext2D, scale: number) => {
    const node = rawNode as TrustGraphNode & { x: number; y: number };
    const radius = node.type === "institution" ? 8 : node.type === "application" ? 5.5 : node.type === "document" ? 5 : 4.2;
    context.beginPath();
    if (node.type === "document") {
      context.moveTo(node.x, node.y - radius); context.lineTo(node.x + radius, node.y); context.lineTo(node.x, node.y + radius); context.lineTo(node.x - radius, node.y); context.closePath();
    } else if (node.type === "address") {
      context.rect(node.x - radius, node.y - radius, radius * 2, radius * 2);
    } else context.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    context.fillStyle = node.flagged ? "#b3261e" : nodeColor[node.type];
    context.fill();
    if (node.id === selected?.id) {
      context.beginPath(); context.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI); context.strokeStyle = "#b3261e"; context.lineWidth = 1.5 / scale; context.stroke();
    }
    if (scale > 0.8 || node.type === "institution" || node.flagged) {
      const label = node.label.length > 36 ? `${node.label.slice(0, 34)}…` : node.label;
      context.font = `${node.type === "institution" ? 11 : 9}px Inter, sans-serif`;
      context.textAlign = "center"; context.textBaseline = "top"; context.fillStyle = "#263748";
      context.fillText(label, node.x, node.y + radius + 3);
    }
  }, [selected]);

  const selectNode = (node: TrustGraphNode) => { setSelected(node); setDrawerOpen(true); };
  const doZoom = (delta: number) => graphRef.current?.zoom(Math.max(0.35, Math.min(3, (graphRef.current?.zoom() ?? 1) + delta)), 250);

  if (!user) return <main className="graph-auth"><section><span className="graph-kicker">ZOOMIN · REVIEW WORKSPACE</span><h1>Trust graph</h1><p>Sign in with an officer account to view the synthetic association graph.</p><Link href="/">Return to sign in</Link></section></main>;

  if (role === "applicant") {
    return (
      <OfficerShell page="trust_graph" email={user.email ?? ""} role={role} caseHref={caseHref}>
        <div className="review-empty">
          <FileText size={21} />
          <strong>This workspace is not available for your role.</strong>
          <p>Trust graph cross-application indicators are restricted to review officers.</p>
        </div>
      </OfficerShell>
    );
  }

  return <OfficerShell page="trust_graph" email={user.email ?? ""} role={role} caseHref={caseHref}>
      <section className="trust-page">
        <div className="trust-title-row"><div><p className="trust-kicker">AICTE APPLICATION REVIEW / ASSOCIATIONS</p><h1>Trust graph</h1><p>Explore shared details across synthetic applications.</p></div><span className="trust-alert-count"><AlertTriangle size={14} /> {graph?.alerts.length ?? 0} indicators</span></div>
        <div className="trust-controls"><label className="trust-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search synthetic records" suppressHydrationWarning /></label></div>
        <div className="trust-filters" role="group" aria-label="Filter graph records">
          {types.map(({ id, label, color, icon: Icon }) => {
            const count = id === "all" ? graph?.nodes.length ?? 0 : graph?.nodes.filter((node) => node.type === id).length ?? 0;
            return <button key={id} onClick={() => setFilter(id)} className={filter === id ? "selected" : ""}><Icon size={14} color={color} />{label}<span>{count}</span></button>;
          })}
        </div>
        <div className="trust-content-grid">
          <section className="trust-canvas-wrap">
            <div className="trust-canvas-top"><span>ASSOCIATION NETWORK</span><div className="trust-canvas-tools"><button title="Zoom in" onClick={() => doZoom(0.2)}><ZoomIn size={15} /></button><button title="Zoom out" onClick={() => doZoom(-0.2)}><ZoomOut size={15} /></button><button title="Reset view" onClick={() => { graphRef.current?.zoom(1, 250); graphRef.current?.centerAt(0, 0, 250); }}><RotateCcw size={15} /></button><button onClick={() => setDrawerOpen(!drawerOpen)}>{drawerOpen ? "Hide details" : "Details"}</button></div></div>
            <div className="trust-canvas" aria-label="Interactive force-directed graph">
              {loading ? <div className="graph-empty">Loading graph data…</div> : error ? <div className="graph-empty graph-error">{error}</div> : !graphData.nodes.length ? <div className="graph-empty">No matching records.</div> : (
                <ForceGraph ref={graphRef} graphData={graphData} nodeId="id" nodeLabel={(node: TrustGraphNode) => node.label} nodeCanvasObject={paintNode} nodePointerAreaPaint={(node: TrustGraphNode, color: string, context: CanvasRenderingContext2D) => { context.fillStyle = color; context.beginPath(); context.arc(node.x ?? 0, node.y ?? 0, 12, 0, Math.PI * 2); context.fill(); }} linkColor={(link: TrustGraphEdge) => edgeColor[link.type] ?? "#c6c9cd"} linkWidth={(link: TrustGraphEdge) => link.why_flagged ? 1.8 : 0.6} linkDirectionalParticles={(link: TrustGraphEdge) => link.why_flagged ? 2 : 0} linkDirectionalParticleWidth={1.5} onNodeClick={(node: object) => selectNode(node as TrustGraphNode)} onBackgroundClick={() => setSelected(null)} backgroundColor="#fcfbf8" cooldownTicks={110} d3VelocityDecay={0.32} />
              )}
            </div>
            <div className="trust-legend"><span><i className="legend-institution" />Institution</span><span><i className="legend-faculty" />Faculty</span><span><i className="legend-document" />Document</span><span><i className="legend-address" />Address</span><span><i className="legend-alert" />Flagged link</span></div>
          </section>
          {drawerOpen && <aside className="trust-inspector">
            <div className="inspector-head"><div><p className="trust-kicker">WHY FLAGGED</p><h2>{selected?.label ?? "Review indicators"}</h2></div>{selected && <button onClick={() => setSelected(null)} aria-label="Clear selection">×</button>}</div>
            {selected ? <>
              <p className="inspector-type">{selected.type.replaceAll("_", " ").toUpperCase()} {selected.application_id && <span>· {selected.application_id}</span>}</p>
              {selectedEdges.length ? <div className="inspector-list">{selectedEdges.map((edge) => <article key={edge.id} className={edge.why_flagged ? "flagged" : ""}><span>{edge.type.replaceAll("_", " ")}</span><p>{edge.why_flagged ?? "This record is linked to a related application item."}</p></article>)}</div> : <p className="inspector-muted">No direct links in the current filter.</p>}
              {selectedAlerts.map((alert) => <article key={alert.finding_id} className="graph-alert-card"><span>{alert.severity.toUpperCase()} · INDICATOR</span><p>{alert.reason}</p><small>Evidence: {alert.evidence.extracted}</small></article>)}
            </> : <>
              {graph?.alerts.slice(0, 8).map((alert) => <button key={alert.finding_id} className="alert-row" onClick={() => { const node = graph.nodes.find((item) => item.application_key === alert.application_id); if (node) selectNode(node); }}><span className={`alert-severity severity-${alert.severity}`}>{alert.severity}</span><span><strong>{alert.type.replaceAll("_", " ")}</strong><small>{alert.reason}</small></span></button>)}
              {!graph?.alerts.length && <p className="inspector-muted">No shared signals in this dataset.</p>}
            </>}
          </aside>}
        </div>
      </section>
    </OfficerShell>;
}
