"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";
import DashboardInsights from "../components/DashboardInsights";

// ── Types ────────────────────────────────────────────────────────────
type DashRow = {
  player_id: string;
  name: string;
  rating: number;
  games: number;
  avg_points: number;
  win_pct: number;
  delta_last_10: number;
  max_score?: number;
  min_score?: number;
  win_streak?: number;
  wins?: number;
  avg_rating?: number;
  best_rating?: number;
  worst_rating?: number;
  rating_history?: number[];
  best_map?: string;
  best_map_wins?: number;
};

type HistoryRow = {
  player_id: string;
  rating_after: number;
  match_index: number;
};

type MapStat = {
  map: string;
  total_plays: number;
  total_wins: number;
  win_rate: number;
  avg_points: number;
  best_player: string;
  best_player_win_rate: number;
  best_player_avg: number;
};

// ── Supabase Client ──────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Chart colors ─────────────────────────────────────────────────────
const CHART_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

// ── Sparkline Component (SVG) ────────────────────────────────────────
function Sparkline({ data, width = 80, height = 24, color = "#3b82f6" }: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!data || data.length < 2) return <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const lastVal = data[data.length - 1];
  const prevVal = data[data.length - 2];
  const endColor = lastVal >= prevVal ? "var(--accent-green)" : "var(--accent-red)";
  return (
    <svg width={width} height={height} className="sparkline-svg" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={pad + ((data.length - 1) / (data.length - 1)) * (width - pad * 2)}
        cy={pad + (1 - (lastVal - min) / range) * (height - pad * 2)}
        r="2.5"
        fill={endColor}
      />
    </svg>
  );
}

// ── Win Percentage Bar ───────────────────────────────────────────────
function WinPctBar({ pct }: { pct: number }) {
  const color = pct >= 40 ? "var(--accent-green)" : pct >= 25 ? "var(--accent-orange)" : "var(--accent-red)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span className="winpct-bar">
        <span className="winpct-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </span>
      <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{pct.toFixed(0)}%</span>
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ██  DASHBOARD PAGE  █████████████████████████████████████████████████
// ══════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const [rows, setRows] = useState<DashRow[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [mapStats, setMapStats] = useState<MapStat[]>([]);
  const [activeTab, setActiveTab] = useState<"ranking" | "charts" | "maps">("ranking");
  const chartRef = useRef<Chart | null>(null);
  const winsChartRef = useRef<Chart | null>(null);
  const pointsDistChartRef = useRef<Chart | null>(null);
  const [topScores, setTopScores] = useState<{ player_name: string; points: number; match_date: string | null }[]>([]);
  const [lowScores, setLowScores] = useState<{ player_name: string; points: number; match_date: string | null }[]>([]);
  const [summary, setSummary] = useState({
    topPlayer: { name: "", rating: 0, diff: 0 },
    bestImprovement: { name: "", value: 0 },
    worstDecline: { name: "", value: 0 },
    activeStreak: { name: "", value: 0 },
    lastPlace: { name: "", rating: 0 },
  });

  // ── Load Dashboard Data ────────────────────────────────────────────
  async function loadDashboard() {
    const { data, error } = await supabase
      .from("v_dashboard_players")
      .select("*")
      .order("rating", { ascending: false });
    if (!error && data) {
      const baseRows: DashRow[] = (data as unknown as DashRow[]).map((r) => ({ ...r }));
      setSelectedPlayers(baseRows.slice(0, 5).map((d) => d.player_id));
      computeAdditionalMetrics(baseRows).then(({ rowsWithStats, highs, lows, currentStreakMap }) => {
        setRows(rowsWithStats);
        setTopScores(highs);
        setLowScores(lows);
        computeSummaryMetrics(rowsWithStats, currentStreakMap);
      });
    }
  }

  // ── Load Rating History ────────────────────────────────────────────
  async function loadHistory(playerIds: string[]) {
    if (playerIds.length === 0) { setHistory([]); return; }
    const { data } = await supabase
      .from("v_rating_history_with_order")
      .select("player_id, rating_after, match_index")
      .in("player_id", playerIds)
      .order("match_index", { ascending: true });
    setHistory((data as HistoryRow[]) || []);
  }

  // ── Load Map Statistics ────────────────────────────────────────────
  async function loadMapStats() {
    const { data: entriesData } = await supabase
      .from("match_entries")
      .select("match_id, player_id, points, map");
    const { data: playersData } = await supabase
      .from("players")
      .select("id, name");
    const { data: matchesData } = await supabase
      .from("matches")
      .select("id, match_date, created_at");

    const entries = (entriesData || []) as { match_id: string; player_id: string; points: number; map: string | null }[];
    const playerMap: Record<string, string> = {};
    (playersData || []).forEach((p: any) => { playerMap[p.id] = p.name; });

    // Group entries by match for winner determination
    const matchGroups: Record<string, { player_id: string; points: number; map: string | null }[]> = {};
    entries.forEach((e) => {
      if (!matchGroups[e.match_id]) matchGroups[e.match_id] = [];
      matchGroups[e.match_id].push(e);
    });

    // Aggregate map statistics
    const mapData: Record<string, {
      total_plays: number;
      total_points: number;
      wins: number;
      player_stats: Record<string, { plays: number; wins: number; total_points: number }>;
    }> = {};

    Object.values(matchGroups).forEach((group) => {
      const maxPts = Math.max(...group.map(e => Number(e.points)));
      const winners = group.filter(e => Number(e.points) === maxPts).map(e => e.player_id);

      group.forEach((e) => {
        if (!e.map) return;
        if (!mapData[e.map]) {
          mapData[e.map] = { total_plays: 0, total_points: 0, wins: 0, player_stats: {} };
        }
        const md = mapData[e.map];
        md.total_plays++;
        md.total_points += Number(e.points);
        if (winners.includes(e.player_id)) md.wins++;

        if (!md.player_stats[e.player_id]) {
          md.player_stats[e.player_id] = { plays: 0, wins: 0, total_points: 0 };
        }
        md.player_stats[e.player_id].plays++;
        md.player_stats[e.player_id].total_points += Number(e.points);
        if (winners.includes(e.player_id)) md.player_stats[e.player_id].wins++;
      });
    });

    const stats: MapStat[] = Object.entries(mapData).map(([map, d]) => {
      // Find best player by win rate (min 2 games) or avg points
      let bestPid = "";
      let bestWinRate = -1;
      let bestAvg = 0;
      Object.entries(d.player_stats).forEach(([pid, ps]) => {
        const wr = ps.plays >= 2 ? ps.wins / ps.plays : 0;
        const avg = ps.total_points / ps.plays;
        if (wr > bestWinRate || (wr === bestWinRate && avg > bestAvg)) {
          bestPid = pid;
          bestWinRate = wr;
          bestAvg = avg;
        }
      });
      return {
        map,
        total_plays: d.total_plays,
        total_wins: d.wins,
        win_rate: d.total_plays > 0 ? (d.wins / d.total_plays) * 100 : 0,
        avg_points: d.total_plays > 0 ? d.total_points / d.total_plays : 0,
        best_player: playerMap[bestPid] || bestPid,
        best_player_win_rate: bestWinRate * 100,
        best_player_avg: bestAvg,
      };
    }).sort((a, b) => b.total_plays - a.total_plays);

    setMapStats(stats);
  }

  useEffect(() => { loadDashboard(); loadMapStats(); }, []);
  useEffect(() => { loadHistory(selectedPlayers); }, [selectedPlayers]);

  // ── Summary Metrics ────────────────────────────────────────────────
  function computeSummaryMetrics(rowsWithStats: DashRow[], currentStreakMap: Record<string, number>) {
    if (rowsWithStats.length === 0) return;
    const sortedByRating = [...rowsWithStats].sort((a, b) => Number(b.rating) - Number(a.rating));
    const top = sortedByRating[0];
    const second = sortedByRating[1];
    const diff = second ? Math.round(Number(top.rating) - Number(second.rating)) : Math.round(Number(top.rating));
    let best = top, worst = top;
    for (const row of rowsWithStats) {
      if (row.delta_last_10 > best.delta_last_10) best = row;
      if (row.delta_last_10 < worst.delta_last_10) worst = row;
    }
    let streakPid = top.player_id, streakVal = 0;
    for (const pid in currentStreakMap) {
      if (currentStreakMap[pid] > streakVal) { streakVal = currentStreakMap[pid]; streakPid = pid; }
    }
    const streakPlayerRow = rowsWithStats.find((r) => r.player_id === streakPid);
    const sortedAsc = [...rowsWithStats].sort((a, b) => Number(a.rating) - Number(b.rating));
    const last = sortedAsc[0];
    setSummary({
      topPlayer: { name: top.name, rating: top.rating, diff },
      bestImprovement: { name: best.name, value: Number(best.delta_last_10) },
      worstDecline: { name: worst.name, value: Number(worst.delta_last_10) },
      activeStreak: { name: streakPlayerRow?.name || streakPid, value: streakVal },
      lastPlace: { name: last.name, rating: last.rating },
    });
  }

  // ── Compute Additional Metrics ─────────────────────────────────────
  async function computeAdditionalMetrics(baseRows: DashRow[]) {
    // Rating history for avg/best/worst rating and sparklines
    const { data: ratingData } = await supabase.from("rating_history").select("player_id, rating_after");
    const ratingMap: Record<string, { sum: number; count: number; best: number; worst: number; history: number[] }> = {};
    (ratingData || []).forEach((rh: any) => {
      const pid = rh.player_id;
      const val = Number(rh.rating_after);
      if (!ratingMap[pid]) {
        ratingMap[pid] = { sum: val, count: 1, best: val, worst: val, history: [val] };
      } else {
        ratingMap[pid].sum += val;
        ratingMap[pid].count += 1;
        if (val > ratingMap[pid].best) ratingMap[pid].best = val;
        if (val < ratingMap[pid].worst) ratingMap[pid].worst = val;
        ratingMap[pid].history.push(val);
      }
    });

    // Match entries
    const { data: entriesData } = await supabase.from("match_entries").select("match_id, player_id, points, map");
    const matchEntries = (entriesData || []) as { match_id: string; player_id: string; points: number; map: string | null }[];

    if (matchEntries.length === 0) {
      const rowsWithStats = baseRows.map((row) => ({
        ...row,
        avg_rating: ratingMap[row.player_id] ? ratingMap[row.player_id].sum / ratingMap[row.player_id].count : undefined,
        best_rating: ratingMap[row.player_id]?.best,
        worst_rating: ratingMap[row.player_id]?.worst,
        rating_history: ratingMap[row.player_id]?.history || [],
      }));
      return { rowsWithStats, highs: [] as any[], lows: [] as any[], currentStreakMap: {} };
    }

    const { data: playersData } = await supabase.from("players").select("id, name");
    const playersMap: Record<string, string> = {};
    (playersData || []).forEach((p: any) => { playersMap[p.id] = p.name; });

    const { data: matchesData } = await supabase.from("matches").select("id, match_date, created_at");
    const matchesMap: Record<string, { match_date: string | null; created_at: string | null }> = {};
    (matchesData || []).forEach((m: any) => { matchesMap[m.id] = { match_date: m.match_date || null, created_at: m.created_at || null }; });

    // Max/min points
    const maxMinMap: Record<string, { max: number; min: number }> = {};
    matchEntries.forEach((e) => {
      const pid = e.player_id;
      const pts = Number(e.points);
      if (!maxMinMap[pid]) maxMinMap[pid] = { max: pts, min: pts };
      else {
        if (pts > maxMinMap[pid].max) maxMinMap[pid].max = pts;
        if (pts < maxMinMap[pid].min) maxMinMap[pid].min = pts;
      }
    });

    // Group by match
    const matchGroups: Record<string, { player_id: string; points: number; map: string | null }[]> = {};
    matchEntries.forEach((e) => {
      if (!matchGroups[e.match_id]) matchGroups[e.match_id] = [];
      matchGroups[e.match_id].push({ player_id: e.player_id, points: Number(e.points), map: e.map });
    });

    const matchIdList = Object.keys(matchGroups);
    matchIdList.sort((a, b) => {
      const ma = matchesMap[a] || { match_date: null, created_at: null };
      const mb = matchesMap[b] || { match_date: null, created_at: null };
      const dateA = ma.match_date ? new Date(ma.match_date).getTime() : 0;
      const dateB = mb.match_date ? new Date(mb.match_date).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      const createdA = ma.created_at ? new Date(ma.created_at).getTime() : 0;
      const createdB = mb.created_at ? new Date(mb.created_at).getTime() : 0;
      return createdA - createdB;
    });

    // Streaks, wins, best map
    const currentStreak: Record<string, number> = {};
    const winStreakMap: Record<string, number> = {};
    const winsCount: Record<string, number> = {};
    // Best map tracking: map -> { wins, plays } per player
    const playerMapWins: Record<string, Record<string, { wins: number; plays: number }>> = {};

    matchIdList.forEach((matchId) => {
      const entries = matchGroups[matchId];
      if (!entries || entries.length === 0) return;
      let maxPts = entries[0].points;
      for (const e of entries) { if (e.points > maxPts) maxPts = e.points; }
      const winners = entries.filter((e) => e.points === maxPts).map((e) => e.player_id);
      winners.forEach((pid) => { winsCount[pid] = (winsCount[pid] || 0) + 1; });

      // Track map wins
      entries.forEach((e) => {
        if (e.map) {
          if (!playerMapWins[e.player_id]) playerMapWins[e.player_id] = {};
          if (!playerMapWins[e.player_id][e.map]) playerMapWins[e.player_id][e.map] = { wins: 0, plays: 0 };
          playerMapWins[e.player_id][e.map].plays++;
          if (winners.includes(e.player_id)) playerMapWins[e.player_id][e.map].wins++;
        }
      });

      for (const e of entries) {
        const pid = e.player_id;
        if (winners.includes(pid)) {
          currentStreak[pid] = (currentStreak[pid] || 0) + 1;
          if (!winStreakMap[pid] || currentStreak[pid] > winStreakMap[pid]) winStreakMap[pid] = currentStreak[pid];
        } else {
          currentStreak[pid] = 0;
        }
      }
    });

    // Top/bottom scores
    const sortedDesc = [...matchEntries].sort((a, b) => Number(b.points) - Number(a.points));
    const sortedAsc = [...matchEntries].sort((a, b) => Number(a.points) - Number(b.points));
    const highs = sortedDesc.slice(0, 5).map((e) => ({
      player_name: playersMap[e.player_id] || e.player_id,
      points: Number(e.points),
      match_date: (matchesMap[e.match_id] || { match_date: null }).match_date,
    }));
    const lows = sortedAsc.slice(0, 5).map((e) => ({
      player_name: playersMap[e.player_id] || e.player_id,
      points: Number(e.points),
      match_date: (matchesMap[e.match_id] || { match_date: null }).match_date,
    }));

    // Merge stats
    const rowsWithStats: DashRow[] = baseRows.map((row) => {
      // Find best map (most wins)
      let bestMap = "";
      let bestMapWins = 0;
      const pmw = playerMapWins[row.player_id];
      if (pmw) {
        Object.entries(pmw).forEach(([map, stats]) => {
          if (stats.wins > bestMapWins) { bestMapWins = stats.wins; bestMap = map; }
        });
      }
      return {
        ...row,
        avg_rating: ratingMap[row.player_id] ? ratingMap[row.player_id].sum / ratingMap[row.player_id].count : undefined,
        best_rating: ratingMap[row.player_id]?.best,
        worst_rating: ratingMap[row.player_id]?.worst,
        rating_history: ratingMap[row.player_id]?.history || [],
        max_score: maxMinMap[row.player_id]?.max,
        min_score: maxMinMap[row.player_id]?.min,
        win_streak: winStreakMap[row.player_id] ?? 0,
        wins: winsCount[row.player_id] ?? 0,
        best_map: bestMap || undefined,
        best_map_wins: bestMapWins || undefined,
      };
    });

    return { rowsWithStats, highs, lows, currentStreakMap: { ...currentStreak } };
  }

  // ── Wins Bar Chart ─────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== "charts") return;
    const canvas = document.getElementById("winsChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (winsChartRef.current) winsChartRef.current.destroy();
    const sorted = [...rows].sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));
    winsChartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: sorted.map((r) => r.name),
        datasets: [{
          label: "Vitórias",
          data: sorted.map((r) => r.wins ?? 0),
          backgroundColor: sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: "#94a3b8", font: { size: 11 } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#64748b", precision: 0 },
            grid: { color: "rgba(30, 41, 59, 0.5)" },
          },
        },
      },
    });
  }, [rows, activeTab]);

  // ── Points Distribution Chart ──────────────────────────────────────
  useEffect(() => {
    if (activeTab !== "charts") return;
    const canvas = document.getElementById("pointsDistChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (pointsDistChartRef.current) pointsDistChartRef.current.destroy();
    const sorted = [...rows].sort((a, b) => Number(b.avg_points) - Number(a.avg_points));
    pointsDistChartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: sorted.map((r) => r.name),
        datasets: [
          {
            label: "Média",
            data: sorted.map((r) => Math.round(Number(r.avg_points))),
            backgroundColor: "rgba(59, 130, 246, 0.7)",
            borderRadius: 6,
            borderSkipped: false,
          },
          {
            label: "Máx",
            data: sorted.map((r) => r.max_score ?? 0),
            backgroundColor: "rgba(34, 197, 94, 0.5)",
            borderRadius: 6,
            borderSkipped: false,
          },
          {
            label: "Mín",
            data: sorted.map((r) => r.min_score ?? 0),
            backgroundColor: "rgba(239, 68, 68, 0.5)",
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 11 } } },
        },
        scales: {
          x: {
            ticks: { color: "#94a3b8", font: { size: 11 } },
            grid: { display: false },
          },
          y: {
            ticks: { color: "#64748b" },
            grid: { color: "rgba(30, 41, 59, 0.5)" },
          },
        },
      },
    });
  }, [rows, activeTab]);

  // ── Rating Evolution Chart ─────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== "charts") return;
    const canvas = document.getElementById("ratingChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    if (chartRef.current) chartRef.current.destroy();

    const grouped: Record<string, HistoryRow[]> = {};
    history.forEach((h) => {
      if (!grouped[h.player_id]) grouped[h.player_id] = [];
      grouped[h.player_id].push(h);
    });

    const datasets = selectedPlayers.map((pid, idx) => {
      const player = rows.find((r) => r.player_id === pid);
      const data = (grouped[pid] || []).map((h) => ({ x: h.match_index, y: h.rating_after }));
      return {
        label: player?.name || pid,
        data,
        borderColor: CHART_COLORS[idx % CHART_COLORS.length],
        backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] + "20",
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: false,
      };
    });

    const dataLabelPlugin = {
      id: "dataLabelPlugin",
      afterDatasetsDraw(chart: any) {
        const { ctx } = chart;
        ctx.save();
        chart.data.datasets.forEach((dataset: any, di: number) => {
          const meta = chart.getDatasetMeta(di);
          meta.data.forEach((el: any, i: number) => {
            const dp = dataset.data[i];
            if (!dp) return;
            const val = typeof dp === "object" ? dp.y : dp;
            const pos = el.tooltipPosition();
            ctx.fillStyle = "#94a3b8";
            ctx.font = "9px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(Math.round(val).toString(), pos.x, pos.y - 6);
          });
        });
        ctx.restore();
      },
    };

    chartRef.current = new Chart(canvas, {
      type: "line",
      data: { labels: [], datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 11 }, usePointStyle: true, pointStyle: "circle" } },
          tooltip: { backgroundColor: "#1e293b", titleColor: "#f1f5f9", bodyColor: "#94a3b8", borderColor: "#334155", borderWidth: 1 },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Partida", color: "#64748b", font: { size: 11 } },
            ticks: { color: "#64748b", precision: 0 },
            grid: { color: "rgba(30, 41, 59, 0.3)" },
          },
          y: {
            title: { display: true, text: "Rating", color: "#64748b", font: { size: 11 } },
            ticks: { color: "#64748b" },
            grid: { color: "rgba(30, 41, 59, 0.3)" },
          },
        },
      },
      plugins: [dataLabelPlugin],
    });
  }, [history, rows, selectedPlayers, activeTab]);

  // Toggle player selection for charts
  const togglePlayer = useCallback((pid: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid]
    );
  }, []);

  // ══════════════════════════════════════════════════════════════════
  // ██  RENDER  ██████████████████████████████████████████████████████
  // ══════════════════════════════════════════════════════════════════
  return (
    <div className="container">
      {/* ── Header ── */}
      <div className="app-header">
        <div>
          <h1>RATING DA TROPA DO 7</h1>
          <div className="subtitle">
            Rating criado em janeiro/2026 para o jogo 7 Wonders. A temporada encerra-se
            no primeiro jogo da Copa de 2026 (Brasil × Marrocos, 13/06/2026).
          </div>
        </div>
        <div className="header-actions">
          <a href="/compare" className="btn btn-primary">Comparar</a>
          <a href="/admin" className="btn btn-secondary">Admin</a>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="summary-grid">
        <div className="summary-card top-player">
          <div className="summary-label">Top Player</div>
          <div className="summary-name">{summary.topPlayer.name || "—"}</div>
          <div className="summary-value" style={{ color: "var(--accent-gold)" }}>
            {Math.round(summary.topPlayer.rating || 0)}
          </div>
          <div className="summary-badge" style={{ background: "rgba(59,130,246,0.15)", color: "var(--accent-blue-light)" }}>
            +{summary.topPlayer.diff} pts do 2º
          </div>
        </div>
        <div className="summary-card improvement">
          <div className="summary-label">Maior Evolução</div>
          <div className="summary-name">{summary.bestImprovement.name || "—"}</div>
          <div className="summary-value" style={{ color: "var(--accent-green)" }}>
            {summary.bestImprovement.value >= 0 ? "+" : ""}{summary.bestImprovement.value.toFixed(1)}
          </div>
          <div className="summary-badge" style={{ background: "rgba(34,197,94,0.12)", color: "var(--accent-green)" }}>
            últimas 10
          </div>
        </div>
        <div className="summary-card decline">
          <div className="summary-label">Maior Queda</div>
          <div className="summary-name">{summary.worstDecline.name || "—"}</div>
          <div className="summary-value" style={{ color: "var(--accent-red)" }}>
            {summary.worstDecline.value >= 0 ? "+" : ""}{summary.worstDecline.value.toFixed(1)}
          </div>
          <div className="summary-badge" style={{ background: "rgba(239,68,68,0.12)", color: "var(--accent-red)" }}>
            últimas 10
          </div>
        </div>
        <div className="summary-card streak">
          <div className="summary-label">Streak Ativa</div>
          <div className="summary-name">{summary.activeStreak.name || "—"}</div>
          <div className="summary-value" style={{ color: "var(--accent-orange)" }}>
            {summary.activeStreak.value}
          </div>
          <div className="summary-badge" style={{ background: "rgba(245,158,11,0.12)", color: "var(--accent-orange)" }}>
            vitórias seguidas
          </div>
        </div>
        <div className="summary-card last-place">
          <div className="summary-label">Lanterna</div>
          <div className="summary-name">{summary.lastPlace.name || "—"}</div>
          <div className="summary-value" style={{ color: "var(--accent-purple)" }}>
            {Math.round(summary.lastPlace.rating || 0)}
          </div>
          <div className="summary-badge" style={{ background: "rgba(168,85,247,0.12)", color: "var(--accent-purple)" }}>
            treine mais!
          </div>
        </div>
      </div>

      {/* ── AI Insights ── */}
      <div className="card insights-card section-gap">
        <div className="card-title">Resumo IA das Últimas Partidas</div>
        <DashboardInsights recentMatches={10} />
      </div>

      {/* ── Tab Navigation ── */}
      <div className="tab-nav">
        <button className={`tab-btn ${activeTab === "ranking" ? "active" : ""}`} onClick={() => setActiveTab("ranking")}>
          Ranking
        </button>
        <button className={`tab-btn ${activeTab === "charts" ? "active" : ""}`} onClick={() => setActiveTab("charts")}>
          Gráficos
        </button>
        <button className={`tab-btn ${activeTab === "maps" ? "active" : ""}`} onClick={() => setActiveTab("maps")}>
          Estatísticas dos Mapas
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ██  TAB: RANKING  ████████████████████████████████████████ */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "ranking" && (
        <div className="grid grid-main">
          <div className="card">
            <div className="card-title">Ranking Geral</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Jogador</th>
                    <th className="right">Rating</th>
                    <th className="right hide-mobile">Melhor</th>
                    <th className="right hide-mobile">Pior</th>
                    <th className="center hide-mobile">Evolução</th>
                    <th className="right">Vitórias</th>
                    <th className="right hide-mobile">% Vitórias</th>
                    <th className="right hide-mobile">Partidas</th>
                    <th className="right hide-mobile">Média Pts</th>
                    <th className="right hide-mobile">Streak</th>
                    <th className="center hide-mobile">Melhor Mapa</th>
                    <th className="right">Δ10</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={13} className="empty-state">Nenhuma partida registrada ainda.</td></tr>
                  )}
                  {rows.map((r, i) => {
                    let rankClass = "";
                    if (i === 0) rankClass = "rank-1";
                    else if (i === 1) rankClass = "rank-2";
                    else if (i === 2) rankClass = "rank-3";
                    else if (i === rows.length - 1 && rows.length > 3) rankClass = "rank-last";

                    let badgeClass = "normal";
                    if (i === 0) badgeClass = "gold";
                    else if (i === 1) badgeClass = "silver";
                    else if (i === 2) badgeClass = "bronze";
                    else if (i === rows.length - 1 && rows.length > 3) badgeClass = "last";

                    return (
                      <tr key={r.player_id} className={rankClass}>
                        <td><span className={`pos-badge ${badgeClass}`}>{i + 1}</span></td>
                        <td>
                          <a href={`/players/${r.player_id}`} className="player-link">{r.name}</a>
                        </td>
                        <td className="right">
                          <span className="rating-badge">{Math.round(r.rating)}</span>
                        </td>
                        <td className="right hide-mobile">
                          <span className="rating-best">
                            {r.best_rating !== undefined ? Math.round(r.best_rating) : "—"}
                          </span>
                        </td>
                        <td className="right hide-mobile">
                          <span className="rating-worst">
                            {r.worst_rating !== undefined ? Math.round(r.worst_rating) : "—"}
                          </span>
                        </td>
                        <td className="center sparkline-cell hide-mobile">
                          <Sparkline
                            data={r.rating_history || []}
                            color={CHART_COLORS[i % CHART_COLORS.length]}
                          />
                        </td>
                        <td className="right" style={{ fontWeight: 700 }}>{r.wins ?? 0}</td>
                        <td className="right hide-mobile">
                          <WinPctBar pct={r.win_pct * 100} />
                        </td>
                        <td className="right hide-mobile">{r.games}</td>
                        <td className="right hide-mobile">{Math.round(Number(r.avg_points))}</td>
                        <td className="right hide-mobile">{r.win_streak ?? 0}</td>
                        <td className="center hide-mobile">
                          {r.best_map ? (
                            <span className="map-badge">{r.best_map} ({r.best_map_wins}W)</span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>—</span>
                          )}
                        </td>
                        <td className="right">
                          {r.delta_last_10 > 0 && <span className="delta-up">+{Number(r.delta_last_10).toFixed(1)}</span>}
                          {r.delta_last_10 < 0 && <span className="delta-down">{Number(r.delta_last_10).toFixed(1)}</span>}
                          {Number(r.delta_last_10) === 0 && <span className="delta-neutral">0.0</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Score Lists */}
          <div className="score-section">
            {topScores.length > 0 && (
              <div className="card">
                <div className="score-card-header" style={{ color: "var(--accent-green)" }}>
                  Top 5 Pontuações
                </div>
                <ul className="score-list">
                  {topScores.map((s, idx) => (
                    <li key={idx} className="score-item">
                      <span className="score-rank">{idx + 1}.</span>
                      <span className="score-player">{s.player_name}</span>
                      <span className="score-points" style={{ color: "var(--accent-green)" }}>
                        {s.points.toFixed(0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {lowScores.length > 0 && (
              <div className="card">
                <div className="score-card-header" style={{ color: "var(--accent-blue-light)" }}>
                  5 Menores Pontuações
                </div>
                <ul className="score-list">
                  {lowScores.map((s, idx) => (
                    <li key={idx} className="score-item">
                      <span className="score-rank">{idx + 1}.</span>
                      <span className="score-player">{s.player_name}</span>
                      <span className="score-points" style={{ color: "var(--accent-red)" }}>
                        {s.points.toFixed(0)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ██  TAB: CHARTS  █████████████████████████████████████████ */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "charts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Rating Evolution */}
          <div className="card">
            <div className="card-title">Evolução do Rating</div>
            <div style={{ marginBottom: 8, fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Clique para selecionar/remover jogadores:
            </div>
            <div className="player-chips">
              {rows.map((r, i) => (
                <span
                  key={r.player_id}
                  className={`player-chip ${selectedPlayers.includes(r.player_id) ? "selected" : ""}`}
                  onClick={() => togglePlayer(r.player_id)}
                  style={selectedPlayers.includes(r.player_id) ? {
                    borderColor: CHART_COLORS[i % CHART_COLORS.length],
                    background: CHART_COLORS[i % CHART_COLORS.length] + "20",
                    color: CHART_COLORS[i % CHART_COLORS.length],
                  } : {}}
                >
                  {r.name}
                </span>
              ))}
            </div>
            <div className="chart-container" style={{ height: 350 }}>
              <canvas id="ratingChart" />
            </div>
          </div>

          {/* Wins Distribution */}
          <div className="grid grid-2">
            <div className="card">
              <div className="card-title">Distribuição de Vitórias</div>
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="winsChart" />
              </div>
            </div>

            {/* Points Distribution */}
            <div className="card">
              <div className="card-title">Pontuações (Média / Máx / Mín)</div>
              <div className="chart-container" style={{ height: 280 }}>
                <canvas id="pointsDistChart" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ██  TAB: MAP STATS  ██████████████████████████████████████ */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === "maps" && (
        <div>
          <div className="card section-gap">
            <div className="card-title">Visão Geral dos Mapas</div>
            {mapStats.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🗺️</div>
                <div>Nenhum dado de mapa registrado ainda.</div>
              </div>
            ) : (
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Mapa</th>
                      <th className="right">Jogadas</th>
                      <th className="right">Vitórias</th>
                      <th className="right">Win Rate</th>
                      <th className="right">Média Pts</th>
                      <th>Melhor Player</th>
                      <th className="right hide-mobile">Win Rate Player</th>
                      <th className="right hide-mobile">Média Player</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapStats.map((ms) => (
                      <tr key={ms.map}>
                        <td><span className="map-badge">{ms.map}</span></td>
                        <td className="right">{ms.total_plays}</td>
                        <td className="right" style={{ fontWeight: 700 }}>{ms.total_wins}</td>
                        <td className="right">
                          <WinPctBar pct={ms.win_rate} />
                        </td>
                        <td className="right" style={{ fontWeight: 600 }}>{ms.avg_points.toFixed(0)}</td>
                        <td>
                          <span style={{ color: "var(--accent-blue-light)", fontWeight: 600 }}>{ms.best_player}</span>
                        </td>
                        <td className="right hide-mobile">{ms.best_player_win_rate.toFixed(0)}%</td>
                        <td className="right hide-mobile">{ms.best_player_avg.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Map Cards */}
          {mapStats.length > 0 && (
            <div className="map-stats-grid">
              {mapStats.map((ms) => (
                <div key={ms.map} className="map-stat-card">
                  <div className="map-stat-header">
                    <div className="map-stat-name">{ms.map}</div>
                    <div className="map-stat-plays">{ms.total_plays} jogadas</div>
                  </div>
                  <div className="map-stat-metrics">
                    <div className="map-metric">
                      <div className="map-metric-label">Win Rate</div>
                      <div className="map-metric-value" style={{ color: "var(--accent-green)" }}>
                        {ms.win_rate.toFixed(0)}%
                      </div>
                    </div>
                    <div className="map-metric">
                      <div className="map-metric-label">Média Pts</div>
                      <div className="map-metric-value" style={{ color: "var(--accent-blue-light)" }}>
                        {ms.avg_points.toFixed(0)}
                      </div>
                    </div>
                    <div className="map-metric">
                      <div className="map-metric-label">Total Vitórias</div>
                      <div className="map-metric-value" style={{ color: "var(--accent-orange)" }}>
                        {ms.total_wins}
                      </div>
                    </div>
                    <div className="map-metric">
                      <div className="map-metric-label">Jogadas</div>
                      <div className="map-metric-value" style={{ color: "var(--text-secondary)" }}>
                        {ms.total_plays}
                      </div>
                    </div>
                  </div>
                  <div className="map-best-player">
                    <div>
                      <div className="map-best-label">Melhor Player</div>
                      <div className="map-best-name">{ms.best_player}</div>
                      <div className="map-best-stat">
                        {ms.best_player_win_rate.toFixed(0)}% win rate · {ms.best_player_avg.toFixed(0)} pts média
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
