"use client";

import { useEffect, useRef, useState } from "react";
// Import the AI-powered insights component.  This component will
// fetch a summary of the player's performance via our new API route
// and display it alongside the existing statistics.
// Use a relative import because the project does not configure a baseUrl
// alias for the @ prefix.  Relative path traverses back to the src
// folder and into the components directory.
import PlayerInsights from '../../../components/PlayerInsights';
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

/**
 * Dynamic player profile page.  It loads a player's name, statistics and
 * match history and presents a suite of metrics and visualisations.  The
 * stats include total matches, wins, second/third places, average points,
 * standard deviation, consistency (std/mean), best/worst finish and
 * percentage of top‑3 finishes.  Two charts are rendered: a line chart
 * showing points scored over time (by match order) and a bar chart
 * summarising how often the player finishes in each position.
 */

type MatchEntry = { match_id: string; points: number };

// Client side Supabase client.  Only NEXT_PUBLIC_* environment variables
// are exposed to the browser at runtime.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function PlayerProfilePage() {
  // Extract the player ID from the dynamic route.
  const params = useParams();
  // In Next.js app router, dynamic segments are provided as key/value pairs.
  const playerId = params?.id as string;
  const [playerName, setPlayerName] = useState<string>("");
  // Store a variety of statistics about the player.  Additional
  // fields track the maximum and minimum scores and the longest
  // winning streak.  These metrics complement the existing
  // statistics (total matches, wins, second/third places, average
  // points, standard deviation, best/worst finish and top‑3 rate).
  const [stats, setStats] = useState({
    total: 0,
    wins: 0,
    seconds: 0,
    thirds: 0,
    avg: 0,
    std: 0,
    best: 0,
    worst: 0,
    top3pct: 0,
    maxScore: 0,
    minScore: 0,
    winStreak: 0,
  });
  const [pointsOverTime, setPointsOverTime] = useState<{
    index: number;
    points: number;
  }[]>([]);
  const [placeDistribution, setPlaceDistribution] = useState<Record<number, number>>({});
  const lineChartRef = useRef<Chart | null>(null);
  const barChartRef = useRef<Chart | null>(null);

  // Load player information and compute stats when the id changes.
  useEffect(() => {
    async function load() {
      if (!playerId) return;
      // Fetch player name.
      const { data: playerData } = await supabase
        .from("players")
        .select("name")
        .eq("id", playerId)
        .single();
      setPlayerName(playerData?.name || "");
      // Fetch the player's entries (points per match).
      const { data: entriesData } = await supabase
        .from("match_entries")
        .select("match_id,points")
        .eq("player_id", playerId);
      const entries = (entriesData as MatchEntry[]) || [];
      const totalMatches = entries.length;
      // Compute average and standard deviation of points.
      const pts = entries.map((e) => Number(e.points));
      const avg = pts.reduce((s, p) => s + p, 0) / (pts.length || 1);
      const variance = pts.reduce((s, p) => s + (p - avg) * (p - avg), 0) / (pts.length || 1);
      const std = Math.sqrt(variance);
      // Fetch all match entries for these match IDs so we can compute
      // rankings (first, second, third etc).  Without this grouping the
      // server must send multiple requests per match, which is less efficient.
      const matchIds = entries.map((e) => e.match_id);
      let wins = 0;
      let seconds = 0;
      let thirds = 0;
      let bestPlacement = Number.MAX_SAFE_INTEGER;
      let worstPlacement = 0;
      let top3Count = 0;
      const distribution: Record<number, number> = {};
      // Prepare a groups map outside of the conditional so it can be
      // referenced later when computing the winning streak.
      const groups: Record<string, { player_id: string; points: number }[]> = {};
      if (matchIds.length > 0) {
        const { data: allEntriesData } = await supabase
          .from("match_entries")
          .select("match_id,player_id,points")
          .in("match_id", matchIds);
        const allEntries = (allEntriesData || []) as {
          match_id: string;
          player_id: string;
          points: number;
        }[];
        // Group by match.
        allEntries.forEach((e) => {
          if (!groups[e.match_id]) groups[e.match_id] = [];
          groups[e.match_id].push(e);
        });
        // Compute ranking per match.  Ties result in the same rank for those players.
        Object.entries(groups).forEach(([mid, list]) => {
          const sorted = [...list].sort((a, b) => Number(b.points) - Number(a.points));
          const rankMap: Record<string, number> = {};
          let currentRank = 1;
          for (let i = 0; i < sorted.length; i++) {
            if (i > 0 && Number(sorted[i].points) < Number(sorted[i - 1].points)) {
              currentRank = i + 1;
            }
            rankMap[sorted[i].player_id] = currentRank;
          }
          const r = rankMap[playerId];
          if (r !== undefined) {
            if (!distribution[r]) distribution[r] = 0;
            distribution[r] += 1;
            if (r === 1) wins += 1;
            else if (r === 2) seconds += 1;
            else if (r === 3) thirds += 1;
            if (r < bestPlacement) bestPlacement = r;
            if (r > worstPlacement) worstPlacement = r;
            if (r <= 3) top3Count += 1;
          }
        });
      }
      // Compute points over time.  Use the global match_index so the horizontal axis represents the order of matches globally.
      let timeline: { index: number; points: number }[] = [];
      if (matchIds.length > 0) {
        const { data: rhData } = await supabase
          .from("v_rating_history_with_order")
          .select("match_id,match_index")
          .eq("player_id", playerId);
        const indexMap: Record<string, number> = {};
        (rhData || []).forEach((row: any) => {
          indexMap[row.match_id] = row.match_index;
        });
        timeline = entries
          .filter((e) => indexMap[e.match_id] !== undefined)
          .map((e) => ({ index: indexMap[e.match_id], points: Number(e.points) }))
          .sort((a, b) => a.index - b.index);
      }
      const top3pct = totalMatches > 0 ? (top3Count / totalMatches) * 100 : 0;
      // Compute the player's highest and lowest scores (max/min of points array).
      const maxScore = pts.length > 0 ? Math.max(...pts) : 0;
      const minScore = pts.length > 0 ? Math.min(...pts) : 0;
      // Compute the longest winning streak.  A winning streak is a series of consecutive matches (in global order) where the player finishes first (ties included).  Use the match index from v_rating_history_with_order to sort matches globally.
      let winStreak = 0;
      if (matchIds.length > 0) {
        // Use the previously fetched indexMap if available.  If there is no index data, the streak remains zero.
        const indexMap: Record<string, number> = {};
        const { data: rhData } = await supabase
          .from("v_rating_history_with_order")
          .select("match_id,match_index")
          .eq("player_id", playerId);
        (rhData || []).forEach((row: any) => {
          indexMap[row.match_id] = row.match_index;
        });
        // Only consider matches where we have an index (the player might not have a rating_history entry for some older matches).
        const orderedIds = matchIds
          .filter((mid) => indexMap[mid] !== undefined)
          .sort((a, b) => indexMap[a] - indexMap[b]);
        // Determine winners per match using the groups computed above.
        let current = 0;
        orderedIds.forEach((mid) => {
          const list = groups[mid] || [];
          if (list.length === 0) return;
          // Find the maximum points for this match.
          let localMax = list[0].points;
          for (const e of list) {
            if (e.points > localMax) localMax = e.points;
          }
          // Determine if the player is a winner.
          const winners = list
            .filter((e) => Number(e.points) === Number(localMax))
            .map((e) => e.player_id);
          if (winners.includes(playerId)) {
            current += 1;
            if (current > winStreak) winStreak = current;
          } else {
            current = 0;
          }
        });
      }
      setStats({
        total: totalMatches,
        wins,
        seconds,
        thirds,
        avg,
        std,
        best: bestPlacement === Number.MAX_SAFE_INTEGER ? 0 : bestPlacement,
        worst: worstPlacement,
        top3pct,
        maxScore,
        minScore,
        winStreak,
      });
      setPointsOverTime(timeline);
      setPlaceDistribution(distribution);
    }
    load();
  }, [playerId]);

  // Render or update the points chart whenever the timeline changes.
  useEffect(() => {
    const canvas1 = document.getElementById("pointsChart") as HTMLCanvasElement | null;
    if (canvas1) {
      if (lineChartRef.current) lineChartRef.current.destroy();
      const data = {
        labels: [],
        datasets: [
          {
            label: "Pontos",
            data: pointsOverTime.map((p) => ({ x: p.index, y: p.points })),
          },
        ],
      };
      lineChartRef.current = new Chart(canvas1, {
        type: "line",
        data,
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: "#e9eefc" } },
          },
          scales: {
            x: {
              type: "linear",
              title: { display: true, text: "Ordem da Partida", color: "#e9eefc" },
              ticks: { color: "#93a4c7", precision: 0 },
            },
            y: {
              title: { display: true, text: "Pontos", color: "#e9eefc" },
              ticks: { color: "#93a4c7" },
            },
          },
        },
      });
    }
  }, [pointsOverTime]);

  // Render or update the bar chart whenever the distribution changes.
  useEffect(() => {
    const canvas2 = document.getElementById("placementChart") as HTMLCanvasElement | null;
    if (canvas2) {
      if (barChartRef.current) barChartRef.current.destroy();
      const labels = Object.keys(placeDistribution)
        .map((k) => Number(k))
        .sort((a, b) => a - b);
      const dataCounts = labels.map((k) => placeDistribution[k] || 0);
      barChartRef.current = new Chart(canvas2, {
        type: "bar",
        data: {
          labels: labels.map((l) => `#${l}`),
          datasets: [{ label: "Frequência", data: dataCounts }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              title: { display: true, text: "Colocação", color: "#e9eefc" },
              ticks: { color: "#93a4c7" },
            },
            y: {
              title: { display: true, text: "Partidas", color: "#e9eefc" },
              ticks: { color: "#93a4c7" },
              beginAtZero: true,
            },
          },
        },
      });
    }
  }, [placeDistribution]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Perfil do Jogador</h2>
          <div className="muted">{playerName}</div>
        </div>
        <a href="/" className="muted">
          Voltar ao Dashboard
        </a>
      </div>
      {/* AI-powered summary for the player moved above the statistics so that
          the narrative overview precedes the numeric tables and charts. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Resumo do Jogador (IA)</h3>
        <PlayerInsights playerId={playerId} />
      </div>
      <div className="grid">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Estatísticas</h3>
          <table>
            <tbody>
              <tr>
                <td>Total de partidas</td>
                <td className="right">{stats.total}</td>
              </tr>
              <tr>
                <td>Total de vitórias</td>
                <td className="right">{stats.wins}</td>
              </tr>
              <tr>
                <td>Total em 2º lugar</td>
                <td className="right">{stats.seconds}</td>
              </tr>
              <tr>
                <td>Total em 3º lugar</td>
                <td className="right">{stats.thirds}</td>
              </tr>
              <tr>
                <td>Média de pontos</td>
                <td className="right">{stats.avg.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Desvio padrão de pontos</td>
                <td className="right">{stats.std.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Consistência (std/avg)</td>
                <td className="right">
                  {stats.avg ? (stats.std / stats.avg).toFixed(2) : "0.00"}
                </td>
              </tr>
              {/* Additional player statistics: maximum score, winning streak and worst score */}
              <tr>
                <td>Maior pontuação</td>
                <td className="right">{stats.maxScore.toFixed(1)}</td>
              </tr>
              <tr>
                <td>Maior sequência de vitórias</td>
                <td className="right">{stats.winStreak}</td>
              </tr>
              <tr>
                <td>Pior pontuação</td>
                <td className="right">{stats.minScore.toFixed(1)}</td>
              </tr>
              <tr>
                <td>Melhor colocação</td>
                <td className="right">{stats.best === 0 ? "-" : stats.best}</td>
              </tr>
              <tr>
                <td>Pior colocação</td>
                <td className="right">{stats.worst}</td>
              </tr>
              <tr>
                <td>% Top 3</td>
                <td className="right">{stats.top3pct.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Pontos ao longo do tempo</h3>
          <canvas id="pointsChart" height={160} />
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Distribuição de Colocações</h3>
        <canvas id="placementChart" height={180} />
      </div>
    </div>
  );
}