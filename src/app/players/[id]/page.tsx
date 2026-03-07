"use client";

import { useEffect, useRef, useState } from "react";
import PlayerInsights from "../../../components/PlayerInsights";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

type MatchEntry = { match_id: string; points: number };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

type MapStats = {
  map: string;
  plays: number;
  wins: number;
  winRate: number;
  avgPoints: number;
  winScore: number;
};

export default function PlayerProfilePage() {
  const params = useParams();
  const playerId = params?.id as string;
  const [playerName, setPlayerName] = useState<string>("");
  const [stats, setStats] = useState({
    total: 0, wins: 0, seconds: 0, thirds: 0,
    avg: 0, std: 0, best: 0, worst: 0, top3pct: 0,
    maxScore: 0, minScore: 0, winStreak: 0,
    currentRating: 0, bestRating: 0, worstRating: 0, avgRating: 0,
    winPct: 0, bestMap: "", bestMapWins: 0, winScore: 0,
  });
  const [pointsOverTime, setPointsOverTime] = useState<{ index: number; points: number }[]>([]);
  const [placeDistribution, setPlaceDistribution] = useState<Record<number, number>>({});
  const [ratingOverTime, setRatingOverTime] = useState<{ index: number; rating: number }[]>([]);
  const [mapStats, setMapStats] = useState<MapStats[]>([]);
  const [pointsHistogram, setPointsHistogram] = useState<{ buckets: string[]; counts: number[]; avgPoints: number }>({
    buckets: [],
    counts: [],
    avgPoints: 0,
  });
  const lineChartRef = useRef<Chart | null>(null);
  const barChartRef = useRef<Chart | null>(null);
  const ratingChartRef = useRef<Chart | null>(null);
  const histogramChartRef = useRef<Chart | null>(null);

  useEffect(() => {
    async function load() {
      if (!playerId) return;

      const { data: playerData } = await supabase
        .from("players").select("name").eq("id", playerId).single();
      setPlayerName(playerData?.name || "");

      // Fetch rating history
      const { data: ratingHistData } = await supabase
        .from("v_rating_history_with_order")
        .select("match_id, match_index, rating_after")
        .eq("player_id", playerId)
        .order("match_index", { ascending: true });
      const ratingHist = (ratingHistData || []) as { match_id: string; match_index: number; rating_after: number }[];

      let currentRating = 1000, bestRating = 1000, worstRating = 1000, avgRatingSum = 0;
      const ratingTimeline = ratingHist.map((rh) => {
        const r = Number(rh.rating_after);
        avgRatingSum += r;
        if (r > bestRating) bestRating = r;
        if (r < worstRating) worstRating = r;
        currentRating = r;
        return { index: rh.match_index, rating: r };
      });
      const avgRating = ratingHist.length > 0 ? avgRatingSum / ratingHist.length : 1000;
      setRatingOverTime(ratingTimeline);

      const { data: entriesData } = await supabase
        .from("match_entries").select("match_id,points,map").eq("player_id", playerId);
      const entries = (entriesData || []) as { match_id: string; points: number; map: string | null }[];
      const totalMatches = entries.length;
      const pts = entries.map((e) => Number(e.points));
      const avg = pts.reduce((s, p) => s + p, 0) / (pts.length || 1);
      const variance = pts.reduce((s, p) => s + (p - avg) * (p - avg), 0) / (pts.length || 1);
      const std = Math.sqrt(variance);

      const matchIds = entries.map((e) => e.match_id);
      let wins = 0, seconds = 0, thirds = 0, totalBeaten = 0, totalOpponents = 0;
      let bestPlacement = Number.MAX_SAFE_INTEGER, worstPlacement = 0, top3Count = 0;
      const distribution: Record<number, number> = {};
      const groups: Record<string, { player_id: string; points: number }[]> = {};
      // Map win tracking - extended to track total points per map
      const mapWins: Record<string, { wins: number; plays: number; totalPoints: number; beaten: number; totalOpponents: number }> = {};

      if (matchIds.length > 0) {
        const { data: allEntriesData } = await supabase
          .from("match_entries").select("match_id,player_id,points").in("match_id", matchIds);
        (allEntriesData || []).forEach((e: any) => {
          if (!groups[e.match_id]) groups[e.match_id] = [];
          groups[e.match_id].push(e);
        });

        Object.entries(groups).forEach(([mid, list]) => {
          const sorted = [...list].sort((a, b) => Number(b.points) - Number(a.points));
          const rankMap: Record<string, number> = {};
          let currentRank = 1;
          for (let i = 0; i < sorted.length; i++) {
            if (i > 0 && Number(sorted[i].points) < Number(sorted[i - 1].points)) currentRank = i + 1;
            rankMap[sorted[i].player_id] = currentRank;
          }
          const r = rankMap[playerId];
          if (r !== undefined) {
            distribution[r] = (distribution[r] || 0) + 1;
            if (r === 1) wins++;
            else if (r === 2) seconds++;
            else if (r === 3) thirds++;
            if (r < bestPlacement) bestPlacement = r;
            if (r > worstPlacement) worstPlacement = r;
            if (r <= 3) top3Count++;
          }

          // Check if player won this match for map tracking
          const maxPts = Math.max(...list.map(e => Number(e.points)));
          const isWinner = list.some(e => e.player_id === playerId && Number(e.points) === maxPts);
          const playerEntry = entries.find(e => e.match_id === mid);
          if (playerEntry?.map) {
            if (!mapWins[playerEntry.map]) mapWins[playerEntry.map] = { wins: 0, plays: 0, totalPoints: 0, beaten: 0, totalOpponents: 0 };
            mapWins[playerEntry.map].plays++;
            mapWins[playerEntry.map].totalPoints += Number(playerEntry.points);
            if (isWinner) mapWins[playerEntry.map].wins++;
          }

          // Win Score per match and per map
          const playerPts = Number(list.find(e => e.player_id === playerId)?.points ?? 0);
          const opponents = list.filter(e => e.player_id !== playerId);
          const beaten = opponents.filter(e => Number(e.points) < playerPts).length;
          totalBeaten += beaten;
          totalOpponents += opponents.length;
          // Track win score per map too
          if (playerEntry?.map && mapWins[playerEntry.map]) {
            mapWins[playerEntry.map].beaten += beaten;
            mapWins[playerEntry.map].totalOpponents += opponents.length;
          }
        });
      }

      // Best map
      let bestMap = "", bestMapWins = 0;
      Object.entries(mapWins).forEach(([map, s]) => {
        if (s.wins > bestMapWins) { bestMapWins = s.wins; bestMap = map; }
      });

      // Prepare map statistics
      const mapStatsArray: MapStats[] = Object.entries(mapWins)
        .filter(([_, s]) => s.plays >= 1)
        .map(([map, s]) => ({
          map,
          plays: s.plays,
          wins: s.wins,
          winRate: (s.wins / s.plays) * 100,
          avgPoints: s.totalPoints / s.plays,
          winScore: s.totalOpponents > 0 ? (s.beaten / s.totalOpponents) * 100 : 0,
        }))
        .sort((a, b) => b.winRate - a.winRate);
      setMapStats(mapStatsArray);

      // Timeline
      const indexMap: Record<string, number> = {};
      ratingHist.forEach((rh) => { indexMap[rh.match_id] = rh.match_index; });
      const timeline = entries
        .filter((e) => indexMap[e.match_id] !== undefined)
        .map((e) => ({ index: indexMap[e.match_id], points: Number(e.points) }))
        .sort((a, b) => a.index - b.index);

      // Win streak
      let winStreak = 0, current = 0;
      if (matchIds.length > 0) {
        const orderedIds = matchIds
          .filter((mid) => indexMap[mid] !== undefined)
          .sort((a, b) => indexMap[a] - indexMap[b]);
        orderedIds.forEach((mid) => {
          const list = groups[mid] || [];
          if (list.length === 0) return;
          let localMax = list[0].points;
          for (const e of list) { if (e.points > localMax) localMax = e.points; }
          const ws = list.filter((e) => Number(e.points) === Number(localMax)).map((e) => e.player_id);
          if (ws.includes(playerId)) { current++; if (current > winStreak) winStreak = current; }
          else { current = 0; }
        });
      }

      const maxScore = pts.length > 0 ? Math.max(...pts) : 0;
      const minScore = pts.length > 0 ? Math.min(...pts) : 0;
      const top3pct = totalMatches > 0 ? (top3Count / totalMatches) * 100 : 0;
      const winPct = totalMatches > 0 ? (wins / totalMatches) * 100 : 0;
      const winScore = totalOpponents > 0 ? (totalBeaten / totalOpponents) * 100 : 0;

      // Prepare points histogram (faixas de 5 em 5 pontos)
      if (pts.length > 0) {
        const minPt = Math.min(...pts);
        const maxPt = Math.max(...pts);
        const bucketSize = 5;
        // Align buckets to multiples of 5
        const bucketStart = Math.floor(minPt / bucketSize) * bucketSize;
        const bucketEnd = Math.ceil((maxPt + 1) / bucketSize) * bucketSize;
        const bucketCount = Math.ceil((bucketEnd - bucketStart) / bucketSize);
        const buckets: string[] = [];
        const counts: number[] = new Array(bucketCount).fill(0);

        for (let i = 0; i < bucketCount; i++) {
          const start = bucketStart + i * bucketSize;
          const end = start + bucketSize - 1;
          buckets.push(`${start}-${end}`);
        }

        pts.forEach((p) => {
          const bucketIndex = Math.floor((p - bucketStart) / bucketSize);
          if (bucketIndex >= 0 && bucketIndex < counts.length) {
            counts[bucketIndex]++;
          }
        });

        setPointsHistogram({
          buckets,
          counts,
          avgPoints: avg,
        });
      }

      setStats({
        total: totalMatches, wins, seconds, thirds,
        avg, std,
        best: bestPlacement === Number.MAX_SAFE_INTEGER ? 0 : bestPlacement,
        worst: worstPlacement,
        top3pct, maxScore, minScore, winStreak,
        currentRating, bestRating, worstRating, avgRating: avgRating,
        winPct, bestMap, bestMapWins, winScore,
      });
      setPointsOverTime(timeline);
      setPlaceDistribution(distribution);
    }
    load();
  }, [playerId]);

  // Points chart
  useEffect(() => {
    const canvas = document.getElementById("pointsChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (lineChartRef.current) lineChartRef.current.destroy();
    lineChartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: "Pontos",
          data: pointsOverTime.map((p) => ({ x: p.index, y: p.points })),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: "linear", title: { display: true, text: "Partida", color: "#64748b" }, ticks: { color: "#64748b", precision: 0 }, grid: { color: "rgba(30,41,59,0.3)" } },
          y: { title: { display: true, text: "Pontos", color: "#64748b" }, ticks: { color: "#64748b" }, grid: { color: "rgba(30,41,59,0.3)" } },
        },
      },
    });
  }, [pointsOverTime]);

  // Rating chart
  useEffect(() => {
    const canvas = document.getElementById("ratingChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (ratingChartRef.current) ratingChartRef.current.destroy();
    ratingChartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: "Rating",
          data: ratingOverTime.map((p) => ({ x: p.index, y: p.rating })),
          borderColor: "#a855f7",
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { type: "linear", title: { display: true, text: "Partida", color: "#64748b" }, ticks: { color: "#64748b", precision: 0 }, grid: { color: "rgba(30,41,59,0.3)" } },
          y: { title: { display: true, text: "Rating", color: "#64748b" }, ticks: { color: "#64748b" }, grid: { color: "rgba(30,41,59,0.3)" } },
        },
      },
    });
  }, [ratingOverTime]);

  // Placement chart
  useEffect(() => {
    const canvas = document.getElementById("placementChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (barChartRef.current) barChartRef.current.destroy();
    const labels = Object.keys(placeDistribution).map(Number).sort((a, b) => a - b);
    const dataCounts = labels.map((k) => placeDistribution[k] || 0);
    barChartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels.map((l) => `#${l}`),
        datasets: [{
          label: "Frequência",
          data: dataCounts,
          backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Colocação", color: "#64748b" }, ticks: { color: "#94a3b8" }, grid: { display: false } },
          y: { title: { display: true, text: "Partidas", color: "#64748b" }, ticks: { color: "#64748b", precision: 0 }, beginAtZero: true, grid: { color: "rgba(30,41,59,0.3)" } },
        },
      },
    });
  }, [placeDistribution]);

  // Points histogram chart
  useEffect(() => {
    const canvas = document.getElementById("histogramChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (histogramChartRef.current) histogramChartRef.current.destroy();

    const { buckets, counts, avgPoints } = pointsHistogram;
    if (buckets.length === 0) return;

    // Gradient colors: red -> yellow -> green
    const getBarColor = (index: number, total: number) => {
      const ratio = index / (total - 1);
      if (ratio < 0.5) {
        // Red to Yellow
        const r = 255;
        const g = Math.round(255 * (ratio * 2));
        const b = 0;
        return `rgba(${r},${g},${b},0.8)`;
      } else {
        // Yellow to Green
        const r = Math.round(255 * (2 - ratio * 2));
        const g = 255;
        const b = 0;
        return `rgba(${r},${g},${b},0.8)`;
      }
    };

    const backgroundColor = counts.map((_, i) => getBarColor(i, counts.length));

    histogramChartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: buckets,
        datasets: [{
          label: "Frequência",
          data: counts,
          backgroundColor,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "Faixa de Pontos", color: "#64748b" }, ticks: { color: "#94a3b8", maxRotation: 45, minRotation: 0 }, grid: { display: false } },
          y: { title: { display: true, text: "Partidas", color: "#64748b" }, ticks: { color: "#64748b", precision: 0 }, beginAtZero: true, grid: { color: "rgba(30,41,59,0.3)" } },
        },
      },
    });
  }, [pointsHistogram]);

  // Stat card helper
  const StatItem = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 0", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: "0.9rem", color: color || "var(--text-primary)" }}>{value}</span>
    </div>
  );

  // Win rate visual bar helper
  const WinRateBar = ({ winRate }: { winRate: number }) => (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flex: 1,
    }}>
      <div style={{
        width: "100%",
        height: "6px",
        backgroundColor: "rgba(100, 116, 139, 0.3)",
        borderRadius: "3px",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${Math.min(winRate, 100)}%`,
          height: "100%",
          backgroundColor: winRate > 50 ? "#22c55e" : winRate > 33 ? "#f59e0b" : "#ef4444",
        }} />
      </div>
      <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: "45px", textAlign: "right" }}>
        {winRate.toFixed(1)}%
      </span>
    </div>
  );

  return (
    <div className="container">
      {/* Header */}
      <div className="app-header">
        <div>
          <h1 style={{
            background: "linear-gradient(135deg, var(--accent-blue-light), var(--accent-purple))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            fontSize: "1.5rem", fontWeight: 800,
          }}>
            {playerName || "Jogador"}
          </h1>
          <div className="subtitle">Perfil do Jogador</div>
        </div>
        <a href="/" className="btn btn-secondary">Voltar ao Dashboard</a>
      </div>

      {/* Rating Summary Cards */}
      <div className="summary-grid" style={{ marginBottom: 16 }}>
        <div className="summary-card top-player">
          <div className="summary-label">Rating Atual</div>
          <div className="summary-value" style={{ color: "var(--accent-blue-light)" }}>
            {Math.round(stats.currentRating)}
          </div>
        </div>
        <div className="summary-card improvement">
          <div className="summary-label">Melhor Rating</div>
          <div className="summary-value" style={{ color: "var(--accent-green)" }}>
            {Math.round(stats.bestRating)}
          </div>
        </div>
        <div className="summary-card decline">
          <div className="summary-label">Pior Rating</div>
          <div className="summary-value" style={{ color: "var(--accent-red)" }}>
            {Math.round(stats.worstRating)}
          </div>
        </div>
        <div className="summary-card streak">
          <div className="summary-label">Vitórias</div>
          <div className="summary-value" style={{ color: "var(--accent-orange)" }}>
            {stats.wins}
          </div>
          <div className="summary-badge" style={{ background: "rgba(245,158,11,0.12)", color: "var(--accent-orange)" }}>
            {stats.winPct.toFixed(0)}%
          </div>
        </div>
        <div className="summary-card last-place">
          <div className="summary-label">Melhor Mapa</div>
          <div className="summary-name" style={{ color: "var(--accent-purple)" }}>
            {stats.bestMap || "—"}
          </div>
          {stats.bestMap && (
            <div className="summary-badge" style={{ background: "rgba(168,85,247,0.12)", color: "var(--accent-purple)" }}>
              {stats.bestMapWins}W
            </div>
          )}
        </div>
      </div>

      {/* AI Insights */}
      <div className="card insights-card section-gap">
        <div className="card-title">Resumo do Jogador (IA)</div>
        <PlayerInsights playerId={playerId} />
      </div>

      {/* Stats + Charts */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-title">Estatísticas</div>
          <StatItem label="Total de partidas" value={stats.total} />
          <StatItem label="Vitórias" value={stats.wins} color="var(--accent-green)" />
          <StatItem label="2º lugar" value={stats.seconds} />
          <StatItem label="3º lugar" value={stats.thirds} />
          <StatItem label="% Top 3" value={`${stats.top3pct.toFixed(1)}%`} color="var(--accent-blue-light)" />
          <StatItem label="Média de pontos" value={stats.avg.toFixed(1)} />
          <StatItem label="Desvio padrão" value={stats.std.toFixed(1)} />
          <StatItem label="Consistência (std/avg)" value={stats.avg ? (stats.std / stats.avg).toFixed(2) : "0.00"} />
          <StatItem label="Maior pontuação" value={stats.maxScore.toFixed(0)} color="var(--accent-green)" />
          <StatItem label="Pior pontuação" value={stats.minScore.toFixed(0)} color="var(--accent-red)" />
          <StatItem label="Maior streak de vitórias" value={stats.winStreak} color="var(--accent-orange)" />
          <StatItem label="Rating médio" value={Math.round(stats.avgRating)} />
          <StatItem label="Melhor colocação" value={stats.best === 0 ? "—" : `#${stats.best}`} />
          <StatItem label="Pior colocação" value={stats.worst === 0 ? "—" : `#${stats.worst}`} />
          <StatItem label="Win Score" value={`${stats.winScore.toFixed(1)}%`} color="var(--accent-purple)" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="card-title">Evolução do Rating</div>
            <div className="chart-container" style={{ height: 200 }}>
              <canvas id="ratingChart" />
            </div>
          </div>
          <div className="card">
            <div className="card-title">Pontos ao Longo do Tempo</div>
            <div className="chart-container" style={{ height: 200 }}>
              <canvas id="pointsChart" />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Distribuição de Colocações</div>
        <div className="chart-container" style={{ height: 220 }}>
          <canvas id="placementChart" />
        </div>
      </div>

      {/* Map Statistics Section */}
      {mapStats.length > 0 && (
        <div className="card">
          <div className="card-title">Estatísticas por Mapa</div>
          <div style={{
            overflowX: "auto",
            marginTop: "12px",
          }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
            }}>
              <thead>
                <tr style={{
                  borderBottom: "2px solid var(--border)",
                }}>
                  <th style={{
                    padding: "10px 8px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}>Mapa</th>
                  <th style={{
                    padding: "10px 8px",
                    textAlign: "center",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}>Partidas</th>
                  <th style={{
                    padding: "10px 8px",
                    textAlign: "center",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}>Vitórias</th>
                  <th style={{
                    padding: "10px 8px",
                    textAlign: "left",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}>Win Rate</th>
                  <th style={{
                    padding: "10px 8px",
                    textAlign: "center",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}>Média Pts</th>
                  <th style={{
                    padding: "10px 8px",
                    textAlign: "center",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}>Win Score</th>
                </tr>
              </thead>
              <tbody>
                {mapStats.map((m, idx) => (
                  <tr key={idx} style={{
                    borderBottom: "1px solid var(--border)",
                  }}>
                    <td style={{
                      padding: "10px 8px",
                      verticalAlign: "middle",
                    }}>
                      <span className="map-badge" style={{
                        display: "inline-block",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        backgroundColor: "rgba(59, 130, 246, 0.12)",
                        color: "var(--accent-blue-light)",
                        fontWeight: 500,
                      }}>
                        {m.map}
                      </span>
                    </td>
                    <td style={{
                      padding: "10px 8px",
                      textAlign: "center",
                    }}>
                      {m.plays}
                    </td>
                    <td style={{
                      padding: "10px 8px",
                      textAlign: "center",
                      color: "var(--accent-green)",
                      fontWeight: 600,
                    }}>
                      {m.wins}
                    </td>
                    <td style={{
                      padding: "10px 8px",
                    }}>
                      <WinRateBar winRate={m.winRate} />
                    </td>
                    <td style={{
                      padding: "10px 8px",
                      textAlign: "center",
                      fontWeight: 600,
                    }}>
                      {m.avgPoints.toFixed(1)}
                    </td>
                    <td style={{
                      padding: "10px 8px",
                      textAlign: "center",
                      fontWeight: 600,
                      color: "var(--accent-purple)",
                    }}>
                      {m.winScore.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Points Histogram Section */}
      {pointsHistogram.buckets.length > 0 && (
        <div className="card">
          <div className="card-title">Distribuição de Pontos</div>
          <div className="chart-container" style={{ height: 240, marginTop: "12px" }}>
            <canvas id="histogramChart" />
          </div>
          <div style={{
            marginTop: "12px",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <span style={{ fontWeight: 600 }}>Média: </span>
              {pointsHistogram.avgPoints.toFixed(1)}
            </div>
            <div style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
            }}>
              Linha tracejada mostra a média
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
