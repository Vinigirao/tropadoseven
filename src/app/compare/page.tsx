"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

type Player = { id: string; name: string };
type HistoryRow = { player_id: string; rating_after: number; match_index: number };
type MatchEntry = { match_id: string; player_id: string; points: number };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ComparePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [p1, setP1] = useState<string>("");
  const [p2, setP2] = useState<string>("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [metrics, setMetrics] = useState<{
    common: number; wins1: number; wins2: number; draws: number; avg1: number; avg2: number;
  } | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    async function loadPlayers() {
      const { data, error } = await supabase.from("players").select("id,name").order("name");
      if (!error) setPlayers((data as Player[]) || []);
    }
    loadPlayers();
  }, []);

  useEffect(() => {
    async function loadComparison() {
      if (!p1 || !p2 || p1 === p2) { setHistory([]); setMetrics(null); return; }
      const { data: histData } = await supabase
        .from("v_rating_history_with_order")
        .select("player_id,rating_after,match_index")
        .in("player_id", [p1, p2])
        .order("match_index", { ascending: true });
      setHistory((histData as HistoryRow[]) || []);
      const { data: entriesData } = await supabase
        .from("match_entries").select("match_id,player_id,points").in("player_id", [p1, p2]);
      const entries = (entriesData as MatchEntry[]) || [];
      const grouped: Record<string, MatchEntry[]> = {};
      entries.forEach((e) => { if (!grouped[e.match_id]) grouped[e.match_id] = []; grouped[e.match_id].push(e); });
      let commonMatches = 0, wins1 = 0, wins2 = 0, draws = 0;
      Object.values(grouped).forEach((list) => {
        if (list.length >= 2) {
          commonMatches++;
          const e1 = list.find((e) => e.player_id === p1)!;
          const e2 = list.find((e) => e.player_id === p2)!;
          if (Number(e1.points) > Number(e2.points)) wins1++;
          else if (Number(e1.points) < Number(e2.points)) wins2++;
          else draws++;
        }
      });
      const { data: p1E } = await supabase.from("match_entries").select("points").eq("player_id", p1);
      const { data: p2E } = await supabase.from("match_entries").select("points").eq("player_id", p2);
      const avg1 = p1E && p1E.length > 0 ? (p1E as any[]).reduce((s, e) => s + Number(e.points), 0) / p1E.length : 0;
      const avg2 = p2E && p2E.length > 0 ? (p2E as any[]).reduce((s, e) => s + Number(e.points), 0) / p2E.length : 0;
      setMetrics({ common: commonMatches, wins1, wins2, draws, avg1, avg2 });
    }
    loadComparison();
  }, [p1, p2]);

  useEffect(() => {
    const canvas = document.getElementById("compareChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (chartRef.current) chartRef.current.destroy();
    const grouped: Record<string, HistoryRow[]> = {};
    history.forEach((h) => { if (!grouped[h.player_id]) grouped[h.player_id] = []; grouped[h.player_id].push(h); });
    const datasets: any[] = [];
    const colors = ["#3b82f6", "#a855f7"];
    [p1, p2].forEach((pid, idx) => {
      if (!pid) return;
      const player = players.find((pl) => pl.id === pid);
      datasets.push({
        label: player?.name || pid,
        data: (grouped[pid] || []).map((h) => ({ x: h.match_index, y: h.rating_after })),
        borderColor: colors[idx],
        backgroundColor: colors[idx] + "20",
        borderWidth: 2, pointRadius: 3, tension: 0.3, fill: false,
      });
    });
    if (datasets.length > 0) {
      chartRef.current = new Chart(canvas, {
        type: "line",
        data: { labels: [], datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { labels: { color: "#94a3b8", usePointStyle: true, pointStyle: "circle" } },
            tooltip: { backgroundColor: "#1e293b", titleColor: "#f1f5f9", bodyColor: "#94a3b8", borderColor: "#334155", borderWidth: 1 },
          },
          scales: {
            x: { type: "linear", title: { display: true, text: "Partida", color: "#64748b" }, ticks: { color: "#64748b", precision: 0 }, grid: { color: "rgba(30,41,59,0.3)" } },
            y: { title: { display: true, text: "Rating", color: "#64748b" }, ticks: { color: "#64748b" }, grid: { color: "rgba(30,41,59,0.3)" } },
          },
        },
      });
    }
  }, [history, p1, p2, players]);

  const n1 = players.find((pl) => pl.id === p1);
  const n2 = players.find((pl) => pl.id === p2);

  const MetricRow = ({ label, v1, v2, highlight }: { label: string; v1: string | number; v2: string | number; highlight?: boolean }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: "0.85rem",
    }}>
      <span style={{ fontWeight: 700, color: highlight ? "var(--accent-blue-light)" : "var(--text-primary)", minWidth: 40, textAlign: "center" }}>{v1}</span>
      <span style={{ color: "var(--text-secondary)", flex: 1, textAlign: "center" }}>{label}</span>
      <span style={{ fontWeight: 700, color: highlight ? "var(--accent-purple)" : "var(--text-primary)", minWidth: 40, textAlign: "center" }}>{v2}</span>
    </div>
  );

  return (
    <div className="container">
      <div className="app-header">
        <div>
          <h1 style={{
            background: "linear-gradient(135deg, var(--accent-blue-light), var(--accent-purple))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            fontSize: "1.5rem", fontWeight: 800,
          }}>
            Comparação de Jogadores
          </h1>
          <div className="subtitle">Selecione dois jogadores para comparar métricas e histórico</div>
        </div>
        <a href="/" className="btn btn-secondary">Voltar ao Dashboard</a>
      </div>

      <div className="card section-gap">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>JOGADOR 1</div>
            <select value={p1} onChange={(e) => setP1(e.target.value)} style={{ width: "100%" }}>
              <option value="">— Selecione —</option>
              {players.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", color: "var(--text-muted)", fontWeight: 800, fontSize: "1.2rem", paddingTop: 16 }}>VS</div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>JOGADOR 2</div>
            <select value={p2} onChange={(e) => setP2(e.target.value)} style={{ width: "100%" }}>
              <option value="">— Selecione —</option>
              {players.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {p1 && p2 && p1 !== p2 && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-title">Evolução do Rating</div>
            <div className="chart-container" style={{ height: 300 }}>
              <canvas id="compareChart" />
            </div>
          </div>
          <div className="card">
            <div className="card-title">Head to Head</div>
            {metrics ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, padding: "0 8px" }}>
                  <span style={{ color: "var(--accent-blue-light)", fontWeight: 800, fontSize: "1rem" }}>{n1?.name}</span>
                  <span style={{ color: "var(--accent-purple)", fontWeight: 800, fontSize: "1rem" }}>{n2?.name}</span>
                </div>
                <MetricRow label="Vitórias" v1={metrics.wins1} v2={metrics.wins2} highlight />
                <MetricRow label="Média de Pontos" v1={metrics.avg1.toFixed(1)} v2={metrics.avg2.toFixed(1)} highlight />
                <MetricRow label="Empates" v1={metrics.draws} v2={metrics.draws} />
                <div style={{
                  display: "flex", justifyContent: "center", alignItems: "center",
                  marginTop: 16, padding: "12px", background: "var(--bg-elevated)",
                  borderRadius: "var(--radius-sm)", fontSize: "0.85rem", color: "var(--text-secondary)"
                }}>
                  {metrics.common} jogos em comum
                </div>
              </div>
            ) : (
              <div className="empty-state">Carregando métricas...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
