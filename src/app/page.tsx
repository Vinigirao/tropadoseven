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
      computeAdditionalMetrics(baseRows).then(({ rowsWithStats, highs, lows }) => {
        setRows(rowsWithStats);
        setTopScores(highs);
        setLowScores(lows);
      });
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
    // the base rows and empty top/bottom lists.
    if (matchEntries.length === 0) {
      return { rowsWithStats: baseRows, highs: [], lows: [] };
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
    // participate in a given match retain their current streak.
    const currentStreak: Record<string, number> = {};
    const winStreakMap: Record<string, number> = {};
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
    const rowsWithStats: DashRow[] = baseRows.map((row) => {
      return {
        ...row,
        max_score: maxMinMap[row.player_id]?.max ?? undefined,
        min_score: maxMinMap[row.player_id]?.min ?? undefined,
        win_streak: winStreakMap[row.player_id] ?? 0,
      };
    });
    return { rowsWithStats, highs, lows };
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
    });
  }, [history, rows, selectedPlayers]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Dashboard — 7 Wonders</h2>
          <div className="muted">
            Ranking público (jogadores aparecem após sua primeira partida)
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          {/* Link to player comparison page */}
          <a href="/compare" className="muted">
            Comparar jogadores
          </a>
          <a href="/admin" className="muted">
            Admin
          </a>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ranking</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Jogador</th>
                <th className="right">Rating</th>
                <th className="right">% Vitórias</th>
                <th className="right">Média</th>
                <th className="right">Partidas</th>
                <th className="right">Δ (10)</th>
                {/* Additional columns for maximum score, winning streak and worst score */}
                <th className="right">Máx</th>
                <th className="right">Streak</th>
                <th className="right">Pior</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  {/* The column span should match the total number of table columns (10) */}
                  <td colSpan={10} className="muted">
                    Nenhuma partida registrada ainda.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.player_id}>
                  <td>{i + 1}</td>
                  {/* Make player names link to their profile page */}
                  <td>
                    <a
                      href={`/players/${r.player_id}`}
                      style={{ color: "#e9eefc", textDecoration: "none" }}
                    >
                      {r.name}
                    </a>
                  </td>
                  <td className="right">
                    <b>{Math.round(r.rating)}</b>
                  </td>
                  <td className="right">{(r.win_pct * 100).toFixed(1)}%</td>
                  <td className="right">{Number(r.avg_points).toFixed(1)}</td>
                  <td className="right">{r.games}</td>
                  <td className="right">{Number(r.delta_last_10).toFixed(1)}</td>
                  {/* Display the maximum score (if available) */}
                  <td className="right">{r.max_score !== undefined ? r.max_score.toFixed(1) : "-"}</td>
                  {/* Display the longest winning streak */}
                  <td className="right">{r.win_streak ?? 0}</td>
                  {/* Display the worst score (if available) */}
                  <td className="right">{r.min_score !== undefined ? r.min_score.toFixed(1) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Evolução do Rating</h3>
          <div className="muted" style={{ marginBottom: 8 }}>
            Selecione jogadores para comparar
          </div>
          <select
            multiple
            value={selectedPlayers}
            onChange={(e) =>
              setSelectedPlayers(
                Array.from(e.target.selectedOptions).map((o) => o.value),
              )
            }
            style={{ width: "100%", height: 140 }}
          >
            {rows.map((r) => (
              <option key={r.player_id} value={r.player_id}>
                {r.name}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 12 }}>
            <canvas id="ratingChart" height={140} />
          </div>
          {/* Display lists of highest and lowest scores next to the chart. */}
          {topScores.length > 0 && lowScores.length > 0 && (
            <div
              style={{
                marginTop: 16,
                display: "flex",
                flexWrap: "wrap",
                gap: 24,
              }}
            >
              <div>
                <h4 style={{ margin: "4px 0" }}>Top 5 Pontuações</h4>
                <ul style={{ margin: 0, paddingLeft: 16, listStyleType: "none" }}>
                  {topScores.map((s, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      <span style={{ marginRight: 8 }}>{s.match_date || ""}</span>
                      <span style={{ marginRight: 8 }}>{s.player_name}</span>
                      <b>{s.points.toFixed(1)}</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ margin: "4px 0" }}>5 Menores Pontuações</h4>
                <ul style={{ margin: 0, paddingLeft: 16, listStyleType: "none" }}>
                  {lowScores.map((s, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      <span style={{ marginRight: 8 }}>{s.match_date || ""}</span>
                      <span style={{ marginRight: 8 }}>{s.player_name}</span>
                      <b>{s.points.toFixed(1)}</b>
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