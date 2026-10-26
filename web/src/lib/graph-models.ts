import type { Finding } from "@/lib/models";

export type GraphNodeType = "institution" | "application" | "document" | "faculty" | "address" | "signatory";
export interface TrustGraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  application_id: string | null;
  application_key: string | null;
  institution_name: string | null;
  cluster_id: string | null;
  flagged: boolean;
  x?: number;
  y?: number;
}
export interface TrustGraphEdge {
  id: string;
  source: string | TrustGraphNode;
  target: string | TrustGraphNode;
  type: string;
  weight: number;
  why_flagged: string | null;
}
export interface TrustGraphResponse {
  generated_at: string;
  nodes: TrustGraphNode[];
  edges: TrustGraphEdge[];
  alerts: Finding[];
}
