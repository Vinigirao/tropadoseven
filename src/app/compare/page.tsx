"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

type Player = { id: string; name: string };
type HistoryRow = { player_id: string; rating_after: number; match_index: number };
type MatchEntry = { match_id: string; player_id: string; points: number; map?: string | null };
type CurrentRating = { player_id: string; current_rating: number };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const COLORS = { p1: "#3b82f6", p2: "#a855f7" };

export default function ComparePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [p1, setP1] = useState<string>("");
  const [p2, setP2] = useState<string>("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [metrics, setMetrics] = useState<{
    common: number; wins1: number; wins2: number; draws: number;
    avg1: number; avg2: number; max1: number; max2: number; min1: number; min2: number;
    games1: number; games2: number; std1: number; std2: number;
    winStreak1: number; winStreak2: number; top3pct1: number; top3pct2: number;
    winPct1: number; winPct2: number; winScore1: number; winScore2: number;
    commonMapStats: { map: string; wins1: number; wins2: number; games: number }[];
    h2hHistory: { matchIndex: number; pts1: number; pts2: number }[];
  } | null>(null);
  const [ratings, setRatings] = useState<{ r1: number; r2: number } | null>(null);
  const [winProb, setWinProb] = useState<{ p1: number; p2: number } | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const pointsChartRef = useRef<Chart | null>(null);
  const h2hChartRef = useRef<Chart | null>(null);
  const radarChartRef = useRef<Chart | null>(null);

  useEffect(() => {
    async function loadPlayers() {
      const { data, error } = await supabase.from("players").select("id,name").order("name");
      if (!error) setPlayers((data as Player[]) || []);
    }
    loadPlayers();
  }, []);

  useEffect(() => {
    async function loadComparison() {
      if (!p1 || !p2 || p1 === p2) {
        setHistory([]); setMetrics(null); setRatings(null); setWinProb(null);
        return;
      }

      // Load rating history
      const { data: histData } = await supabase
        .from("v_rating_history_with_order")
        .select("player_id,rating_after,match_index")
        .in("player_id", [p1, p2])
        .order("match_index", { ascending: true });
      setHistory((histData as HistoryRow[]) || []);

      // Load current ratings for win probability
      const { data: ratingData } = await supabase
        .from("v_player_current_rating")
        .select("player_id,current_rating")
        .in("player_id", [p1, p2]);

      if (ratingData && ratingData.length === 2) {
        const r1Obj = (ratingData as CurrentRating[]).find((r) => r.player_id === p1);
        const r2Obj = (ratingData as CurrentRating[]).find((r) => r.player_id === p2);
        if (r1Obj && r2Obj) {
          const r1 = r1Obj.current_rating;
          const r2 = r2Obj.current_rating;
          setRatings({ r1, r2 });
          const p1WinProb = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
          setWinProb({ p1: p1WinProb, p2: 1 - p1WinProb });
        }
      }

      // Load ALL entries for both players
      const { data: entriesData } = await supabase
        .from("match_entries").select("match_id,player_id,points,map").in("player_id", [p1, p2]);
      const entries = (entriesData as MatchEntry[]) || [];

      // Group by match
      const grouped: Record<string, MatchEntry[]> = {};
      entries.forEach((e) => {
        if (!grouped[e.match_id]) grouped[e.match_id] = [];
        grouped[e.match_id].push(e);
      });

      // Head-to-head stats
      let commonMatches = 0, wins1 = 0, wins2 = 0, draws = 0;
      const commonMapStats: Record<string, { wins1: number; wins2: number; games: number }> = {};
      const h2hHistory: { matchIndex: number; pts1: number; pts2: number }[] = [];

      // Get match ordering
      const { data: matchOrderData } = await supabase
        .from("v_rating_history_with_order")
        .select("match_id,match_index")
        .in("player_id", [p1])
        .order("match_index", { ascending: true });
      const matchIndexMap: Record<string, number> = {};
      (matchOrderData || []).forEach((m: any) => { matchIndexMap[m.match_id] = m.match_index; });

      Object.entries(grouped).forEach(([matchId, list]) => {
        const e1 = list.find((e) => e.player_id === p1);
        const e2 = list.find((e) => e.player_id === p2);
        if (e1 && e2) {
          commonMatches++;
          const pts1 = Number(e1.points);
          const pts2 = Number(e2.points);
          if (pts1 > pts2) wins1++;
          else if (pts1 < pts2) wins2++;
          else draws++;

          // Track map stats
          const mapName = e1.map || e2.map || "Desconhecido";
          if (!commonMapStats[mapName]) commonMapStats[mapName] = { wins1: 0, wins2: 0, games: 0 };
          commonMapStats[mapName].games++;
          if (pts1 > pts2) commonMapStats[mapName].wins1++;
          else if (pts1 < pts2) commonMapStats[mapName].wins2++;

          // H2H history
          if (matchIndexMap[matchId] !== undefined) {
            h2hHistory.push({ matchIndex: matchIndexMap[matchId], pts1, pts2 });
          }
        }
      });

      h2hHistory.sort((a, b) => a.matchIndex - b.matchIndex);

      // Individual stats
      const p1Entries = entries.filter((e) => e.player_id === p1);
      const p2Entries = entries.filter((e) => e.player_id === p2);
      const pts1All = p1Entries.map((e) => Number(e.points));
      const pts2All = p2Entries.map((e) => Number(e.points));

      const avg1 = pts1All.length > 0 ? pts1All.reduce((s, p) => s + p, 0) / pts1All.length : 0;
      const avg2 = pts2All.length > 0 ? pts2All.reduce((s, p) => s + p, 0) / pts2All.length : 0;
      const max1 = pts1All.length > 0 ? Math.max(...pts1All) : 0;
      const max2 = pts2All.length > 0 ? Math.max(...pts2All) : 0;
      const min1 = pts1All.length > 0 ? Math.min(...pts1All) : 0;
      const min2 = pts2All.length > 0 ? Math.min(...pts2All) : 0;
      const var1 = pts1All.reduce((s, p) => s + (p - avg1) ** 2, 0) / (pts1All.length || 1);
      const var2 = pts2All.reduce((s, p) => s + (p - avg2) ** 2, 0) / (pts2All.length || 1);
      const std1 = Math.sqrt(var1);
      const std2 = Math.sqrt(var2);

      // Win % and placements - need all entries from all matches
      const allMatchIds = [...new Set(entries.map(e => e.match_id))];
      const { data: allMatchEntriesData } = await supabase
        .from("match_entries").select("match_id,player_id,points").in("match_id", allMatchIds);
      const allEntries = (allMatchEntriesData || []) as { match_id: string; player_id: string; points: number }[];

      const allGroups: Record<string, { player_id: string; points: number }[]> = {};
      allEntries.forEach((e) => {
        if (!allGroups[e.match_id]) allGroups[e.match_id] = [];
        allGroups[e.match_id].push(e);
      });

      let totalWins1 = 0, totalWins2 = 0, top3_1 = 0, top3_2 = 0;
      let ws1 = 0, ws2 = 0, maxWs1 = 0, maxWs2 = 0;
      let beaten1 = 0, totalOpp1 = 0, beaten2 = 0, totalOpp2 = 0;

      // Sort matches by index
      const sortedMatchIds = allMatchIds
        .filter((mid) => matchIndexMap[mid] !== undefined)
        .sort((a, b) => (matchIndexMap[a] ?? 0) - (matchIndexMap[b] ?? 0));

      sortedMatchIds.forEach((matchId) => {
        const list = allGroups[matchId] || [];
        if (list.length === 0) return;
        const maxPts = Math.max(...list.map(e => Number(e.points)));
        const sorted = [...list].sort((a, b) => Number(b.points) - Number(a.points));

        list.forEach((e) => {
          const rank = sorted.findIndex(s => s.player_id === e.player_id) + 1;
          if (e.player_id === p1) {
            if (Number(e.points) === maxPts) { totalWins1++; ws1++; if (ws1 > maxWs1) maxWs1 = ws1; } else { ws1 = 0; }
            if (rank <= 3) top3_1++;
          }
          if (e.player_id === p2) {
            if (Number(e.points) === maxPts) { totalWins2++; ws2++; if (ws2 > maxWs2) maxWs2 = ws2; } else { ws2 = 0; }
            if (rank <= 3) top3_2++;
          }
        });

        // Win Score computation
        const p1Entry = list.find(e => e.player_id === p1);
        const p2Entry = list.find(e => e.player_id === p2);
        if (p1Entry) {
          const opps = list.filter(o => o.player_id !== p1);
          beaten1 += opps.filter(o => Number(p1Entry.points) > Number(o.points)).length;
          totalOpp1 += opps.length;
        }
        if (p2Entry) {
          const opps = list.filter(o => o.player_id !== p2);
          beaten2 += opps.filter(o => Number(p2Entry.points) > Number(o.points)).length;
          totalOpp2 += opps.length;
        }
      });

      const winPct1 = p1Entries.length > 0 ? (totalWins1 / p1Entries.length) * 100 : 0;
      const winPct2 = p2Entries.length > 0 ? (totalWins2 / p2Entries.length) * 100 : 0;
      const top3pct1 = p1Entries.length > 0 ? (top3_1 / p1Entries.length) * 100 : 0;
      const top3pct2 = p2Entries.length > 0 ? (top3_2 / p2Entries.length) * 100 : 0;
      const winScore1 = totalOpp1 > 0 ? (beaten1 / totalOpp1) * 100 : 0;
      const winScore2 = totalOpp2 > 0 ? (beaten2 / totalOpp2) * 100 : 0;

      setMetrics({
        common: commonMatches, wins1, wins2, draws,
        avg1, avg2, max1, max2, min1, min2,
        games1: p1Entries.length, games2: p2Entries.length,
        std1, std2, winStreak1: maxWs1, winStreak2: maxWs2,
        top3pct1, top3pct2, winPct1, winPct2, winScore1, winScore2,
        commonMapStats: Object.entries(commonMapStats)
          .map(([map, s]) => ({ map, ...s }))
          .sort((a, b) => b.games - a.games),
        h2hHistory,
      });
    }
    loadComparison();
  }, [p1, p2]);

  // Rating evolution chart
  useEffect(() => {
    const canvas = document.getElementById("compareChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (chartRef.current) chartRef.current.destroy();
    const grouped: Record<string, HistoryRow[]> = {};
    history.forEach((h) => { if (!grouped[h.player_id]) grouped[h.player_id] = []; grouped[h.player_id].push(h); });
    const datasets: any[] = [];
    [p1, p2].forEach((pid, idx) => {
      if (!pid) return;
      const player = players.find((pl) => pl.id === pid);
      datasets.push({
        label: player?.name || pid,
        data: (grouped[pid] || []).map((h) => ({ x: h.match_index, y: h.rating_after })),
        borderColor: idx === 0 ? COLORS.p1 : COLORS.p2,
        backgroundColor: (idx === 0 ? COLORS.p1 : COLORS.p2) + "20",
        borderWidth: 2, pointRadius: 3, tension: 0.3, fill: false,
      });
    });
    if (datasets.length > 0) {
      chartRef.current = new Chart(canvas, {
        type: "line",
        data: { labels: [], datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
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

  // Points comparison bar chart
  useEffect(() => {
    if (!metrics) return;
    const canvas = document.getElementById("pointsCompareChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (pointsChartRef.current) pointsChartRef.current.destroy();
    const n1Name = players.find((pl) => pl.id === p1)?.name || "J1";
    const n2Name = players.find((pl) => pl.id === p2)?.name || "J2";
    pointsChartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Média", "Máximo", "Mínimo"],
        datasets: [
          {
            label: n1Name,
            data: [Math.round(metrics.avg1), metrics.max1, metrics.min1],
            backgroundColor: COLORS.p1 + "cc",
            borderRadius: 6, borderSkipped: false,
          },
          {
            label: n2Name,
            data: [Math.round(metrics.avg2), metrics.max2, metrics.min2],
            backgroundColor: COLORS.p2 + "cc",
            borderRadius: 6, borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#94a3b8", usePointStyle: true } } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { ticks: { color: "#64748b" }, grid: { color: "rgba(30,41,59,0.3)" } },
        },
      },
    });
  }, [metrics, p1, p2, players]);

  // Head-to-head points history
  useEffect(() => {
    if (!metrics || metrics.h2hHistory.length === 0) return;
    const canvas = document.getElementById("h2hChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (h2hChartRef.current) h2hChartRef.current.destroy();
    const n1Name = players.find((pl) => pl.id === p1)?.name || "J1";
    const n2Name = players.find((pl) => pl.id === p2)?.name || "J2";
    h2hChartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: metrics.h2hHistory.map((_, i) => `Jogo ${i + 1}`),
        datasets: [
          {
            label: n1Name,
            data: metrics.h2hHistory.map((h) => h.pts1),
            borderColor: COLORS.p1,
            backgroundColor: COLORS.p1 + "20",
            borderWidth: 2, pointRadius: 4, tension: 0.3, fill: false,
          },
          {
            label: n2Name,
            data: metrics.h2hHistory.map((h) => h.pts2),
            borderColor: COLORS.p2,
            backgroundColor: COLORS.p2 + "20",
            borderWidth: 2, pointRadius: 4, tension: 0.3, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#94a3b8", usePointStyle: true } },
          tooltip: { backgroundColor: "#1e293b", titleColor: "#f1f5f9", bodyColor: "#94a3b8" },
        },
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } },
          y: { title: { display: true, text: "Pontos", color: "#64748b" }, ticks: { color: "#64748b" }, grid: { color: "rgba(30,41,59,0.3)" } },
        },
      },
    });
  }, [metrics, p1, p2, players]);

  // Radar chart
  useEffect(() => {
    if (!metrics) return;
    const canvas = document.getElementById("radarChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (radarChartRef.current) radarChartRef.current.destroy();
    const n1Name = players.find((pl) => pl.id === p1)?.name || "J1";
    const n2Name = players.find((pl) => pl.id === p2)?.name || "J2";

    // Normalize values to 0-100 scale for radar
    const maxAvg = Math.max(metrics.avg1, metrics.avg2) || 1;
    const maxWinPct = Math.max(metrics.winPct1, metrics.winPct2) || 1;
    const maxWinScore = Math.max(metrics.winScore1, metrics.winScore2) || 1;
    const maxTop3 = Math.max(metrics.top3pct1, metrics.top3pct2) || 1;
    const maxStreak = Math.max(metrics.winStreak1, metrics.winStreak2) || 1;
    const maxConsistency = Math.max(
      metrics.avg1 > 0 ? (1 - metrics.std1 / metrics.avg1) * 100 : 0,
      metrics.avg2 > 0 ? (1 - metrics.std2 / metrics.avg2) * 100 : 0
    ) || 1;
    const maxGames = Math.max(metrics.games1, metrics.games2) || 1;

    radarChartRef.current = new Chart(canvas, {
      type: "radar",
      data: {
        labels: ["Média Pts", "Win %", "Win Score", "Top 3 %", "Streak", "Consistência", "Experiência"],
        datasets: [
          {
            label: n1Name,
            data: [
              (metrics.avg1 / maxAvg) * 100,
              (metrics.winPct1 / maxWinPct) * 100,
              (metrics.winScore1 / maxWinScore) * 100,
              (metrics.top3pct1 / maxTop3) * 100,
              (metrics.winStreak1 / maxStreak) * 100,
              metrics.avg1 > 0 ? ((1 - metrics.std1 / metrics.avg1) * 100 / maxConsistency) * 100 : 0,
              (metrics.games1 / maxGames) * 100,
            ],
            borderColor: COLORS.p1,
            backgroundColor: COLORS.p1 + "30",
            pointBackgroundColor: COLORS.p1,
            pointBorderColor: COLORS.p1,
            borderWidth: 2,
          },
          {
            label: n2Name,
            data: [
              (metrics.avg2 / maxAvg) * 100,
              (metrics.winPct2 / maxWinPct) * 100,
              (metrics.winScore2 / maxWinScore) * 100,
              (metrics.top3pct2 / maxTop3) * 100,
              (metrics.winStreak2 / maxStreak) * 100,
              metrics.avg2 > 0 ? ((1 - metrics.std2 / metrics.avg2) * 100 / maxConsistency) * 100 : 0,
              (metrics.games2 / maxGames) * 100,
            ],
            borderColor: COLORS.p2,
            backgroundColor: COLORS.p2 + "30",
            pointBackgroundColor: COLORS.p2,
            pointBorderColor: COLORS.p2,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#94a3b8", usePointStyle: true } },
        },
        scales: {
          r: {
            angleLines: { color: "rgba(30,41,59,0.5)" },
            grid: { color: "rgba(30,41,59,0.5)" },
            ticks: { display: false },
            pointLabels: { color: "#94a3b8", font: { size: 11 } },
            suggestedMin: 0, suggestedMax: 100,
          },
        },
      },
    });
  }, [metrics, p1, p2, players]);

  const n1 = players.find((pl) => pl.id === p1);
  const n2 = players.find((pl) => pl.id === p2);

  const MetricRow = ({ label, v1, v2, highlight, better }: {
    label: string; v1: string | number; v2: string | number;
    highlight?: boolean; better?: "p1" | "p2" | "none";
  }) => {
    const v1Color = better === "p1" ? "var(--accent-green)" : highlight ? "var(--accent-blue-light)" : "var(--text-primary)";
    const v2Color = better === "p2" ? "var(--accent-green)" : highlight ? "var(--accent-purple)" : "var(--text-primary)";
    return (
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: "0.85rem",
      }}>
        <span style={{ fontWeight: 700, color: v1Color, minWidth: 50, textAlign: "center" }}>{v1}</span>
        <span style={{ color: "var(--text-secondary)", flex: 1, textAlign: "center", fontSize: "0.78rem" }}>{label}</span>
        <span style={{ fontWeight: 700, color: v2Color, minWidth: 50, textAlign: "center" }}>{v2}</span>
      </div>
    );
  };

  // Helper to determine who's better for a metric
  const whosBetter = (v1: number, v2: number, higherIsBetter = true): "p1" | "p2" | "none" => {
    if (v1 === v2) return "none";
    return (higherIsBetter ? v1 > v2 : v1 < v2) ? "p1" : "p2";
  };

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
        <>
          {/* Win Probability Bar */}
          {winProb && ratings && (
            <div className="card section-gap">
              <div className="card-title">Probabilidade de Vitória (Elo)</div>
              <div style={{
                display: "flex", justifyContent: "space-between", marginBottom: 8,
                fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600,
              }}>
                <span>{n1?.name} — Rating: {Math.round(ratings.r1)}</span>
                <span>{n2?.name} — Rating: {Math.round(ratings.r2)}</span>
              </div>
              <div style={{
                display: "flex", height: 44, borderRadius: "var(--radius-sm)",
                overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", marginBottom: 8,
              }}>
                <div style={{
                  width: `${winProb.p1 * 100}%`, backgroundColor: COLORS.p1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 700, fontSize: "1rem",
                  minWidth: winProb.p1 > 0.08 ? undefined : 40,
                }}>
                  {(winProb.p1 * 100).toFixed(1)}%
                </div>
                <div style={{
                  width: `${winProb.p2 * 100}%`, backgroundColor: COLORS.p2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 700, fontSize: "1rem",
                  minWidth: winProb.p2 > 0.08 ? undefined : 40,
                }}>
                  {(winProb.p2 * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center" }}>
                Baseado na fórmula Elo: P = 1 / (1 + 10^((Rb - Ra) / 400))
              </div>
            </div>
          )}

          {/* Radar Chart */}
          {metrics && (
            <div className="card section-gap">
              <div className="card-title">Comparação Geral (Radar)</div>
              <div className="chart-container" style={{ height: 320 }}>
                <canvas id="radarChart" />
              </div>
            </div>
          )}

          {/* Head to Head + Rating Evolution */}
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
                    <span style={{ color: COLORS.p1, fontWeight: 800, fontSize: "1rem" }}>{n1?.name}</span>
                    <span style={{ color: COLORS.p2, fontWeight: 800, fontSize: "1rem" }}>{n2?.name}</span>
                  </div>
                  <MetricRow label="Vitórias (H2H)" v1={metrics.wins1} v2={metrics.wins2}
                    highlight better={whosBetter(metrics.wins1, metrics.wins2)} />
                  <MetricRow label="Empates" v1={metrics.draws} v2={metrics.draws} />
                  <MetricRow label="Win % (Geral)" v1={`${metrics.winPct1.toFixed(0)}%`} v2={`${metrics.winPct2.toFixed(0)}%`}
                    highlight better={whosBetter(metrics.winPct1, metrics.winPct2)} />
                  <MetricRow label="Média de Pontos" v1={metrics.avg1.toFixed(1)} v2={metrics.avg2.toFixed(1)}
                    highlight better={whosBetter(metrics.avg1, metrics.avg2)} />
                  <MetricRow label="Maior Pontuação" v1={metrics.max1} v2={metrics.max2}
                    highlight better={whosBetter(metrics.max1, metrics.max2)} />
                  <MetricRow label="Menor Pontuação" v1={metrics.min1} v2={metrics.min2}
                    highlight better={whosBetter(metrics.min1, metrics.min2)} />
                  <MetricRow label="Desvio Padrão" v1={metrics.std1.toFixed(1)} v2={metrics.std2.toFixed(1)}
                    better={whosBetter(metrics.std1, metrics.std2, false)} />
                  <MetricRow label="Maior Streak" v1={metrics.winStreak1} v2={metrics.winStreak2}
                    highlight better={whosBetter(metrics.winStreak1, metrics.winStreak2)} />
                  <MetricRow label="Top 3 %" v1={`${metrics.top3pct1.toFixed(0)}%`} v2={`${metrics.top3pct2.toFixed(0)}%`}
                    highlight better={whosBetter(metrics.top3pct1, metrics.top3pct2)} />
                  <MetricRow label="Win Score" v1={`${metrics.winScore1.toFixed(1)}%`} v2={`${metrics.winScore2.toFixed(1)}%`}
                    highlight better={whosBetter(metrics.winScore1, metrics.winScore2)} />
                  <MetricRow label="Total de Partidas" v1={metrics.games1} v2={metrics.games2} />
                  <div style={{
                    display: "flex", justifyContent: "center", alignItems: "center",
                    marginTop: 16, padding: "12px", background: "var(--bg-elevated)",
                    borderRadius: "var(--radius-sm)", fontSize: "0.85rem", color: "var(--text-secondary)",
                  }}>
                    {metrics.common} jogos em comum
                  </div>
                </div>
              ) : (
                <div className="empty-state">Carregando métricas...</div>
              )}
            </div>
          </div>

          {/* Points Comparison + H2H History */}
          {metrics && (
            <div className="grid grid-2">
              <div className="card">
                <div className="card-title">Comparação de Pontos</div>
                <div className="chart-container" style={{ height: 280 }}>
                  <canvas id="pointsCompareChart" />
                </div>
              </div>
              {metrics.h2hHistory.length > 0 && (
                <div className="card">
                  <div className="card-title">Pontos nos Jogos em Comum</div>
                  <div className="chart-container" style={{ height: 280 }}>
                    <canvas id="h2hChart" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Map Breakdown */}
          {metrics && metrics.commonMapStats.length > 0 && (
            <div className="card">
              <div className="card-title">Desempenho por Mapa (Jogos em Comum)</div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Mapa</th>
                      <th className="right">Jogos</th>
                      <th className="center" style={{ color: COLORS.p1 }}>{n1?.name}</th>
                      <th className="center" style={{ color: COLORS.p2 }}>{n2?.name}</th>
                      <th className="center">Empates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.commonMapStats.map((ms) => (
                      <tr key={ms.map}>
                        <td><span className="map-badge">{ms.map}</span></td>
                        <td className="right">{ms.games}</td>
                        <td className="center" style={{
                          fontWeight: 700,
                          color: ms.wins1 > ms.wins2 ? "var(--accent-green)" : ms.wins1 === ms.wins2 ? "var(--text-primary)" : "var(--text-secondary)",
                        }}>{ms.wins1}</td>
                        <td className="center" style={{
                          fontWeight: 700,
                          color: ms.wins2 > ms.wins1 ? "var(--accent-green)" : ms.wins2 === ms.wins1 ? "var(--text-primary)" : "var(--text-secondary)",
                        }}>{ms.wins2}</td>
                        <td className="center" style={{ color: "var(--text-muted)" }}>
                          {ms.games - ms.wins1 - ms.wins2}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
