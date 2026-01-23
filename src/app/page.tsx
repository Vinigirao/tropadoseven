"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

// Extend the dashboard row type to include additional statistics for
// maximum score, minimum score and longest winning streak.  These
// fields are optional because they are populated asynchronously
// after the initial ranking data is loaded.
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
  /**
   * Total number of wins for this player.  A win is counted when the
   * player achieves the highest point total in a given match (ties
   * count as wins for all tied players).  This value is computed
   * dynamically alongside other metrics and displayed in the ranking
   * table.
   */
  wins?: number;
};

// Each history row includes the global match order index so the X axis
// can represent the sequence of matches rather than the index per player.
type HistoryRow = {
  player_id: string;
  rating_after: number;
  match_index: number;
};

// Initialise a client-side Supabase client using the anon key. Only
// client‑accessible environment variables are prefixed with NEXT_PUBLIC_.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function DashboardPage() {
  const [rows, setRows] = useState<DashRow[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const chartRef = useRef<Chart | null>(null);
  // Chart reference for the wins bar chart.  This reference allows
  // us to destroy the chart before re‑rendering to avoid memory
  // leaks.
  const winsChartRef = useRef<Chart | null>(null);
  // Hold the top and bottom scores across all players.  Each entry
  // contains the player name, the score and the match date.  These
  // arrays are populated alongside the dashboard rows when loading the
  // dashboard data.
  const [topScores, setTopScores] = useState<
    { player_name: string; points: number; match_date: string | null }[]
  >([]);
  const [lowScores, setLowScores] = useState<
    { player_name: string; points: number; match_date: string | null }[]
  >([]);

  // Summary metrics shown at the top of the dashboard.  Each field
  // contains the player name and the corresponding value.  The top
  // player includes a diff (rating difference to the next player).
  const [summary, setSummary] = useState({
    topPlayer: { name: "", rating: 0, diff: 0 },
    bestImprovement: { name: "", value: 0 },
    worstDecline: { name: "", value: 0 },
    activeStreak: { name: "", value: 0 },
    lastPlace: { name: "", rating: 0 },
  });

  // Load ranking data
  async function loadDashboard() {
    const { data, error } = await supabase
      .from("v_dashboard_players")
      .select("*")
      .order("rating", { ascending: false });
    if (!error && data) {
      // Convert the raw rows into our extended DashRow type.  The
      // additional statistics (max_score, min_score, win_streak) will
      // be computed below.  We intentionally avoid mutating the
      // original data array so that React can detect state changes.
      const baseRows: DashRow[] = (data as unknown as DashRow[]).map((r) => ({
        ...r,
      }));
      // Preselect the top 5 players for the rating chart.
      setSelectedPlayers(baseRows.slice(0, 5).map((d) => d.player_id));
      // Compute additional metrics for each player and the global top/bottom scores.
      computeAdditionalMetrics(baseRows).then(
        ({ rowsWithStats, highs, lows, currentStreakMap }) => {
          setRows(rowsWithStats);
          setTopScores(highs);
          setLowScores(lows);
          // After computing row-level stats, derive summary metrics.
          computeSummaryMetrics(rowsWithStats, currentStreakMap);
        },
      );
    }
  }

  // Load rating history for selected players. Use the view with match order
  // so that the X axis is consistent across players.
  async function loadHistory(playerIds: string[]) {
    if (playerIds.length === 0) {
      setHistory([]);
      return;
    }
    const { data } = await supabase
      .from("v_rating_history_with_order")
      .select("player_id, rating_after, match_index")
      .in("player_id", playerIds)
      .order("match_index", { ascending: true });
    setHistory((data as HistoryRow[]) || []);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    loadHistory(selectedPlayers);
  }, [selectedPlayers]);

  // Build a bar chart showing the total wins per player.  This chart
  // is rendered whenever the ranking rows change.  It uses the
  // Chart.js bar type and hides the legend for a cleaner look.  The
  // X axis lists player names and the Y axis shows the number of
  // victories.  Colours are harmonised with the rest of the dashboard.
  useEffect(() => {
    const canvas = document.getElementById("winsChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    // Destroy any existing chart before creating a new one
    if (winsChartRef.current) {
      winsChartRef.current.destroy();
    }
    // Sort players by number of wins in descending order to make the
    // distribution easier to read.  Ties maintain their relative order.
    const sortedRows = [...rows].sort(
      (a, b) => (b.wins ?? 0) - (a.wins ?? 0),
    );
    const labels = sortedRows.map((r) => r.name);
    const dataPoints = sortedRows.map((r) => r.wins ?? 0);
    winsChartRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Vitórias",
            data: dataPoints,
            backgroundColor: "#4ea1ff",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Jogador",
              color: "#e9eefc",
            },
            ticks: {
              color: "#93a4c7",
              autoSkip: false,
              maxRotation: 90,
              minRotation: 45,
            },
            grid: {
              color: "rgba(35, 49, 82, 0.5)",
            },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: "Vitórias",
              color: "#e9eefc",
            },
            ticks: {
              color: "#93a4c7",
              precision: 0,
            },
            grid: {
              color: "rgba(35, 49, 82, 0.5)",
            },
          },
        },
      },
    });
  }, [rows]);

  /**
   * Compute high-level summary metrics for the dashboard.  These include
   * the top player (by rating) and their rating difference to the
   * runner‑up, the player with the largest positive delta over the last
   * 10 matches, the player with the largest negative delta and the
   * player with the longest currently active winning streak.  The
   * metrics are derived from the dashboard rows and the map of
   * current streaks produced by computeAdditionalMetrics().
   */
  function computeSummaryMetrics(
    rowsWithStats: DashRow[],
    currentStreakMap: Record<string, number>,
  ) {
    if (rowsWithStats.length === 0) return;
    // Top player by rating and difference to next player.
    const sortedByRating = [...rowsWithStats].sort(
      (a, b) => Number(b.rating) - Number(a.rating),
    );
    const top = sortedByRating[0];
    const second = sortedByRating[1];
    const diff = second
      ? Math.round(Number(top.rating) - Number(second.rating))
      : Math.round(Number(top.rating));
    // Player with the greatest improvement (largest positive delta_last_10)
    let best = top;
    let worst = top;
    for (const row of rowsWithStats) {
      if (row.delta_last_10 > best.delta_last_10) {
        best = row;
      }
      if (row.delta_last_10 < worst.delta_last_10) {
        worst = row;
      }
    }
    // Player with longest active win streak
    let streakPid = top.player_id;
    let streakVal = 0;
    for (const pid in currentStreakMap) {
      const val = currentStreakMap[pid];
      if (val > streakVal) {
        streakVal = val;
        streakPid = pid;
      }
    }
    const streakPlayerRow = rowsWithStats.find((r) => r.player_id === streakPid);

    // Determine the last place by rating (smallest rating).  In case
    // of ties, the first encountered lowest rating is chosen.
    const sortedAsc = [...rowsWithStats].sort(
      (a, b) => Number(a.rating) - Number(b.rating),
    );
    const last = sortedAsc[0];
    setSummary({
      topPlayer: { name: top.name, rating: top.rating, diff },
      bestImprovement: { name: best.name, value: Number(best.delta_last_10) },
      worstDecline: { name: worst.name, value: Number(worst.delta_last_10) },
      activeStreak: { name: streakPlayerRow?.name || streakPid, value: streakVal },
      lastPlace: { name: last.name, rating: last.rating },
    });
  }

  /**
   * Compute additional statistics for the dashboard.  Given the base
   * ranking rows, this function fetches all match entries, players and
   * matches from the database and derives per‑player maximum score,
   * minimum score and longest consecutive winning streak.  It also
   * extracts the five highest and five lowest scores across all
   * players along with the corresponding player names and match dates.
   */
  async function computeAdditionalMetrics(baseRows: DashRow[]): Promise<{
    rowsWithStats: DashRow[];
    highs: { player_name: string; points: number; match_date: string | null }[];
    lows: { player_name: string; points: number; match_date: string | null }[];
    currentStreakMap: Record<string, number>;
  }> {
    // Fetch all match entries.  These provide the points scored by
    // each player in each match.
    const { data: entriesData } = await supabase
      .from("match_entries")
      .select("match_id, player_id, points");
    const matchEntries = (entriesData || []) as {
      match_id: string;
      player_id: string;
      points: number;
    }[];

    // If there are no entries (no matches played yet), simply return
    // the base rows and empty top/bottom lists and an empty streak map.
    if (matchEntries.length === 0) {
      return {
        rowsWithStats: baseRows,
        highs: [],
        lows: [],
        currentStreakMap: {},
      };
    }

    // Fetch all players once to map player IDs to names.
    const { data: playersData } = await supabase
      .from("players")
      .select("id, name");
    const playersMap: Record<string, string> = {};
    (playersData || []).forEach((p: any) => {
      playersMap[p.id] = p.name;
    });

    // Fetch matches to obtain match_date and created_at.  This will
    // allow us to sort matches chronologically and attach dates to the
    // top/bottom scores.  Some matches might not have a created_at if
    // they were inserted without a timestamp; default to null.
    const { data: matchesData } = await supabase
      .from("matches")
      .select("id, match_date, created_at");
    const matchesMap: Record<
      string,
      { match_date: string | null; created_at: string | null }
    > = {};
    (matchesData || []).forEach((m: any) => {
      matchesMap[m.id] = {
        match_date: m.match_date || null,
        created_at: m.created_at || null,
      };
    });

    // Compute maximum and minimum points for each player.
    const maxMinMap: Record<string, { max: number; min: number }> = {};
    matchEntries.forEach((e) => {
      const pid = e.player_id;
      const pts = Number(e.points);
      if (!maxMinMap[pid]) {
        maxMinMap[pid] = { max: pts, min: pts };
      } else {
        if (pts > maxMinMap[pid].max) maxMinMap[pid].max = pts;
        if (pts < maxMinMap[pid].min) maxMinMap[pid].min = pts;
      }
    });

    // Group entries by match ID for winner determination.
    const matchGroups: Record<
      string,
      { player_id: string; points: number }[]
    > = {};
    matchEntries.forEach((e) => {
      if (!matchGroups[e.match_id]) matchGroups[e.match_id] = [];
      matchGroups[e.match_id].push({ player_id: e.player_id, points: Number(e.points) });
    });

    // Build a list of unique match IDs and sort them by match_date and created_at.
    const matchIdList = Object.keys(matchGroups);
    matchIdList.sort((a, b) => {
      const ma = matchesMap[a] || { match_date: null, created_at: null };
      const mb = matchesMap[b] || { match_date: null, created_at: null };
      // Compare dates; if either is null, treat as 0.
      const dateA = ma.match_date ? new Date(ma.match_date).getTime() : 0;
      const dateB = mb.match_date ? new Date(mb.match_date).getTime() : 0;
      if (dateA !== dateB) return dateA - dateB;
      // If match dates are equal or null, compare creation timestamps.
      const createdA = ma.created_at ? new Date(ma.created_at).getTime() : 0;
      const createdB = mb.created_at ? new Date(mb.created_at).getTime() : 0;
      return createdA - createdB;
    });

    // Compute longest winning streak for each player.  Maintain
    // per‑player current streak and maximum observed streak.  When a
    // player wins (has the maximum points in the match), increment
    // their current streak; otherwise reset it.  Players who do not
    // participate in a given match retain their current streak.  At
    // the same time, accumulate a count of total wins for each
    // player.  A win is recorded for each player whose points are
    // equal to the maximum for that match (ties count as wins).
    const currentStreak: Record<string, number> = {};
    const winStreakMap: Record<string, number> = {};
    // Map of total wins per player.  Incremented whenever a player
    // achieves the highest score in a match.
    const winsCount: Record<string, number> = {};
    matchIdList.forEach((matchId) => {
      const entries = matchGroups[matchId];
      if (!entries || entries.length === 0) return;
      // Determine the maximum score for this match.
      let maxPts = entries[0].points;
      for (const e of entries) {
        if (e.points > maxPts) maxPts = e.points;
      }
      // Identify winners (players with points equal to the max).
      const winners = entries
        .filter((e) => e.points === maxPts)
        .map((e) => e.player_id);
      // Increase win count for each winner.  Ties count for all
      // participating winners.
      winners.forEach((pid) => {
        winsCount[pid] = (winsCount[pid] || 0) + 1;
      });
      // Update streaks for participating players.
      for (const e of entries) {
        const pid = e.player_id;
        if (winners.includes(pid)) {
          currentStreak[pid] = (currentStreak[pid] || 0) + 1;
          if (!winStreakMap[pid] || currentStreak[pid] > winStreakMap[pid]) {
            winStreakMap[pid] = currentStreak[pid];
          }
        } else {
          currentStreak[pid] = 0;
        }
      }
      // Note: players who did not play in this match keep their streak
      // unchanged; we intentionally do not reset their currentStreak.
    });

    // Determine the top and bottom five scores across all entries.  We
    // sort a copy of the entries by points descending and ascending
    // respectively.  Ties are included but only the first five items
    // after sorting are shown.  Each entry is enriched with the
    // player's name and match date for display.
    const entriesForSort = matchEntries.map((e) => e);
    const sortedDesc = entriesForSort
      .slice()
      .sort((a, b) => Number(b.points) - Number(a.points));
    const sortedAsc = entriesForSort
      .slice()
      .sort((a, b) => Number(a.points) - Number(b.points));
    const highs = sortedDesc.slice(0, 5).map((e) => {
      const m = matchesMap[e.match_id] || { match_date: null };
      return {
        player_name: playersMap[e.player_id] || e.player_id,
        points: Number(e.points),
        match_date: m.match_date,
      };
    });
    const lows = sortedAsc.slice(0, 5).map((e) => {
      const m = matchesMap[e.match_id] || { match_date: null };
      return {
        player_name: playersMap[e.player_id] || e.player_id,
        points: Number(e.points),
        match_date: m.match_date,
      };
    });

    // Merge the computed statistics back into the dashboard rows.
    // In addition to max/min scores and streaks, include the total
    // number of wins per player.  If a player has never won, default
    // to 0.  We avoid mutating the original baseRows array so that
    // React detects state changes correctly.
    const rowsWithStats: DashRow[] = baseRows.map((row) => {
      return {
        ...row,
        max_score: maxMinMap[row.player_id]?.max ?? undefined,
        min_score: maxMinMap[row.player_id]?.min ?? undefined,
        win_streak: winStreakMap[row.player_id] ?? 0,
        wins: winsCount[row.player_id] ?? 0,
      };
    });
    // Capture the current streak map so that the UI can compute active
    // win streaks across players.  Spread to avoid exposing the
    // internal reference.
    const currentStreakMap = { ...currentStreak };
    return { rowsWithStats, highs, lows, currentStreakMap };
  }

  // Rebuild the chart when history or selected players change
  useEffect(() => {
    const canvas = document.getElementById("ratingChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    // Destroy previous chart to avoid memory leaks
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    const grouped: Record<string, HistoryRow[]> = {};
    history.forEach((h) => {
      if (!grouped[h.player_id]) grouped[h.player_id] = [];
      grouped[h.player_id].push(h);
    });
    const datasets = selectedPlayers.map((pid) => {
      // Find the player name for the legend label
      const player = rows.find((r) => r.player_id === pid);
      // Use the match_index as the X value so that the horizontal axis represents the global sequence of matches.
      const data = (grouped[pid] || []).map((h) => ({ x: h.match_index, y: h.rating_after }));
      return {
        label: player?.name || pid,
        data,
      };
    });
    // Define a custom plugin to draw numeric labels above each data point.  This
    // plugin runs after the datasets are drawn and renders the y‑value of
    // each point directly above the marker.  Using a plugin avoids the
    // need for an external Chart.js plugin dependency.
    const dataLabelPlugin = {
      id: "dataLabelPlugin",
      afterDatasetsDraw(chart: any) {
        const { ctx } = chart;
        ctx.save();
        chart.data.datasets.forEach((dataset: any, datasetIndex: number) => {
          const meta = chart.getDatasetMeta(datasetIndex);
          meta.data.forEach((element: any, index: number) => {
            const dp = dataset.data[index];
            if (!dp) return;
            // The data point may be an object with x/y properties or a simple number
            const value = typeof dp === "object" && dp !== null ? dp.y : dp;
            const position = element.tooltipPosition();
            ctx.fillStyle = "#e9eefc";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(Math.round(value).toString(), position.x, position.y - 6);
          });
        });
        ctx.restore();
      },
    };
    chartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets,
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: { color: "#e9eefc" },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: {
              display: true,
              text: "Ordem da Partida",
              color: "#e9eefc",
            },
            ticks: {
              color: "#93a4c7",
              precision: 0,
            },
          },
          y: {
            title: {
              display: true,
              text: "Rating",
              color: "#e9eefc",
            },
            ticks: {
              color: "#93a4c7",
            },
          },
        },
      },
      plugins: [dataLabelPlugin],
    });
  }, [history, rows, selectedPlayers]);

  return (
    <div className="container">
      {/* Header with title, description and navigation buttons */}
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>RATING DA TROPA DO 7</h2>
          {/* Describe the origin of the rating and mention Brazil’s opening match at the 2026 World Cup. */}
          <div className="muted">
            Rating criado em janeiro/2026 para o jogo 7 Wonders. A temporada encerra-se
            no primeiro jogo da Copa de 2026 (Brasil × Marrocos, 13/06/2026).
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          {/* Link to player comparison and admin pages.  Styled as call‑to‑action buttons for prominence. */}
          <a href="/compare" className="cta-button">Comparar jogadores</a>
          <a href="/admin" className="cta-button secondary">Admin</a>
        </div>
      </div>

      {/* Summary cards showing high-level metrics.  These cards mirror the
          visual aesthetic of the provided design by using icons,
          dark backgrounds and coloured highlights. */}
      <div className="summary-grid" style={{ marginBottom: 24 }}>
        <div className="summary-card top-player">
          <div className="summary-icon">🏆</div>
          <div className="summary-content">
            <div className="summary-title">Top Player</div>
            <div className="summary-player-name">{summary.topPlayer.name || "-"}</div>
            <div className="summary-number">{Math.round(summary.topPlayer.rating || 0)}</div>
            <div className="summary-delta" style={{ color: "#4ea1ff" }}>
              {summary.topPlayer.diff >= 0 ? "+" : ""}
              {summary.topPlayer.diff}
            </div>
          </div>
        </div>
        <div className="summary-card improvement">
          <div className="summary-icon">📈</div>
          <div className="summary-content">
            <div className="summary-title">Maior Evolução</div>
            <div className="summary-player-name">{summary.bestImprovement.name || "-"}</div>
            <div className="summary-number" style={{ color: "#4caf50" }}>
              {summary.bestImprovement.value >= 0 ? "+" : ""}
              {summary.bestImprovement.value.toFixed(1)}
            </div>
          </div>
        </div>
        <div className="summary-card decline">
          <div className="summary-icon">📉</div>
          <div className="summary-content">
            <div className="summary-title">Maior Queda</div>
            <div className="summary-player-name">{summary.worstDecline.name || "-"}</div>
            <div className="summary-number" style={{ color: "#e75a5a" }}>
              {summary.worstDecline.value >= 0 ? "+" : ""}
              {summary.worstDecline.value.toFixed(1)}
            </div>
          </div>
        </div>
        <div className="summary-card streak">
          <div className="summary-icon">🏅</div>
          <div className="summary-content">
            <div className="summary-title">Maior Streak Ativa</div>
            <div className="summary-player-name">{summary.activeStreak.name || "-"}</div>
            <div className="summary-number" style={{ color: "#f0ad4e" }}>{summary.activeStreak.value}</div>
          </div>
        </div>
        {/* Last place card to tease the player at the bottom of the ranking */}
        <div className="summary-card last-place">
          <div className="summary-icon">🗑️</div>
          <div className="summary-content">
            <div className="summary-title">Lanterna</div>
            <div className="summary-player-name">{summary.lastPlace.name || "-"}</div>
            <div className="summary-number" style={{ color: "#e75a5a" }}>{Math.round(summary.lastPlace.rating || 0)}</div>
            <div style={{ fontSize: 12, color: "#e75a5a" }}>treine mais!</div>
          </div>
        </div>
      </div>

      {/* Grid with ranking table.  Override the column layout to a single column since the score lists are moved elsewhere. */}
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        {/* Ranking table card */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ranking</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Jogador</th>
                <th className="right">Vitórias</th>
                <th className="right">Rating</th>
                <th className="right">% Vitórias</th>
                <th className="right">Média</th>
                <th className="right">Partidas</th>
                <th className="right">Máx</th>
                <th className="right">Streak</th>
                <th className="right">Pior</th>
                <th className="right">Δ (10)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">Nenhuma partida registrada ainda.</td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.player_id}>
                  <td>
                    {/* Show trophy emojis for the top 3 positions and a trash can for the last position. */}
                    {i === 0 && <span style={{ marginRight: 4 }}>🥇</span>}
                    {i === 1 && <span style={{ marginRight: 4 }}>🥈</span>}
                    {i === 2 && <span style={{ marginRight: 4 }}>🥉</span>}
                    {i === rows.length - 1 && i > 2 && <span style={{ marginRight: 4 }}>🗑️</span>}
                    {i + 1}
                  </td>
                  <td>
                    {/* Make player name a styled button‑like link to emphasise profile access */}
                    <a href={`/players/${r.player_id}`} className="profile-link">{r.name}</a>
                  </td>
                  <td className="right">{r.wins ?? 0}</td>
                  <td className="right"><b>{Math.round(r.rating)}</b></td>
                  <td className="right">{(r.win_pct * 100).toFixed(1)}%</td>
                  <td className="right">{Math.round(Number(r.avg_points))}</td>
                  <td className="right">{r.games}</td>
                  <td className="right">{r.max_score !== undefined ? Math.round(r.max_score) : "-"}</td>
                  <td className="right">{r.win_streak ?? 0}</td>
                  <td className="right">{r.min_score !== undefined ? Math.round(r.min_score) : "-"}</td>
                  <td className="right">
                    {r.delta_last_10 > 0 && <span style={{ color: "#4caf50" }}>▲ {Number(r.delta_last_10).toFixed(1)}</span>}
                    {r.delta_last_10 < 0 && <span style={{ color: "#e75a5a" }}>▼ {Number(r.delta_last_10).toFixed(1)}</span>}
                    {r.delta_last_10 === 0 && <span style={{ color: "#93a4c7" }}>{Number(r.delta_last_10).toFixed(1)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* End of grid columns.  The second column has been removed; the score lists are moved into the wins distribution card. */}
      </div>

      {/* Charts column: rating evolution on top of wins distribution.  The two charts share the same width to align visually. */}
      <div className="charts-container">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Evolução do Rating</h3>
          <div className="muted" style={{ marginBottom: 8 }}>Selecione jogadores para comparar</div>
          <select
            multiple
            value={selectedPlayers}
            onChange={(e) => setSelectedPlayers(Array.from(e.target.selectedOptions).map((o) => o.value))}
            style={{ width: "100%", height: 140 }}
          >
            {rows.map((r) => (
              <option key={r.player_id} value={r.player_id}>{r.name}</option>
            ))}
          </select>
          <div style={{ marginTop: 12 }}>
            <canvas id="ratingChart" height={160} />
          </div>
        </div>
        <div className="card" style={{ marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Distribuição de Vitórias</h3>
          <div>
            <canvas id="winsChart" height={160} />
          </div>
          {/* Display the Top 5 and 5 lowest scores stacked underneath the chart.  The top list remains green and the bottom list inherits the same colour as its numbers (blue). */}
          {topScores.length > 0 && lowScores.length > 0 && (
            <div className="score-list-container" style={{ flexDirection: "column", marginTop: 16 }}>
              {/* Top scores list */}
              <div className="score-card">
                <div className="score-card-header" style={{ color: "#4caf50" }}>🟢 Top 5 Pontuações</div>
                <ul className="score-list">
                  {topScores.map((s, idx) => (
                    <li key={idx} className="score-item">
                      <span className="score-player" style={{ color: "#4caf50" }}>{s.player_name}</span>
                      <span className="score-points" style={{ color: "#4caf50" }}>{s.points.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* Bottom scores list with unified colour */}
              <div className="score-card">
                <div className="score-card-header" style={{ color: "#4ea1ff" }}>❄️ 5 Menores Pontuações</div>
                <ul className="score-list">
                  {lowScores.map((s, idx) => (
                    <li key={idx} className="score-item">
                      <span className="score-player" style={{ color: "#4ea1ff" }}>{s.player_name}</span>
                      <span className="score-points" style={{ color: "#4ea1ff" }}>{s.points.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}