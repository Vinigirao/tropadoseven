"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

/**
 * Page for comparing two players.  Users can select any two players and
 * view their rating evolution, how many games they've played together,
 * head‑to‑head wins and draws, and their average points across all
 * matches.  The layout mirrors the existing dashboard styling by
 * leveraging the same global CSS classes.
 */

type Player = { id: string; name: string };
type HistoryRow = { player_id: string; rating_after: number; match_index: number };
type MatchEntry = { match_id: string; player_id: string; points: number };

// Client‑side Supabase client using the anon credentials.  These
// environment variables are exposed in the browser because they are
// prefixed with NEXT_PUBLIC_.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function ComparePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [p1, setP1] = useState<string>("");
  const [p2, setP2] = useState<string>("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [metrics, setMetrics] = useState<
    | {
        common: number;
        wins1: number;
        wins2: number;
        draws: number;
        avg1: number;
        avg2: number;
      }
    | null
  >(null);
  const chartRef = useRef<Chart | null>(null);

  // Load all players on mount so they can be selected.
  useEffect(() => {
    async function loadPlayers() {
      const { data, error } = await supabase
        .from("players")
        .select("id,name")
        .order("name");
      if (!error) {
        setPlayers((data as Player[]) || []);
      }
    }
    loadPlayers();
  }, []);

  // Whenever either selection changes, recompute comparison data.
  useEffect(() => {
    async function loadComparison() {
      // Reset when selections are invalid (empty or equal)
      if (!p1 || !p2 || p1 === p2) {
        setHistory([]);
        setMetrics(null);
        return;
      }
      // Fetch rating history for both players using the view with global match order.
      const { data: histData } = await supabase
        .from("v_rating_history_with_order")
        .select("player_id,rating_after,match_index")
        .in("player_id", [p1, p2])
        .order("match_index", { ascending: true });
      setHistory((histData as HistoryRow[]) || []);
      // Fetch all match entries for the two players.  We fetch all entries
      // rather than only common matches because it's inexpensive and allows
      // us to compute averages in one place.
      const { data: entriesData } = await supabase
        .from("match_entries")
        .select("match_id,player_id,points")
        .in("player_id", [p1, p2]);
      const entries = (entriesData as MatchEntry[]) || [];
      // Group entries by match to determine games where both players
      // participated.
      const grouped: Record<string, MatchEntry[]> = {};
      entries.forEach((e) => {
        if (!grouped[e.match_id]) grouped[e.match_id] = [];
        grouped[e.match_id].push(e);
      });
      let commonMatches = 0;
      let wins1 = 0;
      let wins2 = 0;
      let draws = 0;
      Object.values(grouped).forEach((list) => {
        // A match is common if both player IDs appear in the group.
        if (list.length >= 2) {
          commonMatches++;
          const e1 = list.find((e) => e.player_id === p1)!;
          const e2 = list.find((e) => e.player_id === p2)!;
          if (Number(e1.points) > Number(e2.points)) wins1++;
          else if (Number(e1.points) < Number(e2.points)) wins2++;
          else draws++;
        }
      });
      // Fetch all points for each player to compute average points across
      // their entire match history.  Supabase does not currently
      // aggregate numeric values in the PostgREST client, so we
      // compute averages in JavaScript.
      const { data: p1Entries } = await supabase
        .from("match_entries")
        .select("points")
        .eq("player_id", p1);
      const { data: p2Entries } = await supabase
        .from("match_entries")
        .select("points")
        .eq("player_id", p2);
      const avg1 =
        p1Entries && p1Entries.length > 0
          ? (p1Entries as { points: number }[]).reduce((sum, e) => sum + Number(e.points), 0) /
            (p1Entries as { points: number }[]).length
          : 0;
      const avg2 =
        p2Entries && p2Entries.length > 0
          ? (p2Entries as { points: number }[]).reduce((sum, e) => sum + Number(e.points), 0) /
            (p2Entries as { points: number }[]).length
          : 0;
      setMetrics({ common: commonMatches, wins1, wins2, draws, avg1, avg2 });
    }
    loadComparison();
  }, [p1, p2]);

  // Draw or update the comparison chart whenever the history or players change.
  useEffect(() => {
    const canvas = document.getElementById("compareChart") as HTMLCanvasElement | null;
    if (!canvas) return;
    // Clean up previous chart to avoid memory leaks.
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    // Group history rows by player ID to build separate datasets.
    const grouped: Record<string, HistoryRow[]> = {};
    history.forEach((h) => {
      if (!grouped[h.player_id]) grouped[h.player_id] = [];
      grouped[h.player_id].push(h);
    });
    const datasets: any[] = [];
    [p1, p2].forEach((pid) => {
      if (!pid) return;
      const player = players.find((pl) => pl.id === pid);
      const data = (grouped[pid] || []).map((h) => ({ x: h.match_index, y: h.rating_after }));
      datasets.push({
        label: player?.name || pid,
        data,
      });
    });
    if (datasets.length > 0) {
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
    }
  }, [history, p1, p2, players]);

  const selectedP1 = players.find((pl) => pl.id === p1);
  const selectedP2 = players.find((pl) => pl.id === p2);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Comparação de Jogadores</h2>
          <div className="muted">Selecione dois jogadores para comparar métricas e histórico</div>
        </div>
        <a href="/" className="muted">
          Voltar ao Dashboard
        </a>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="muted">Jogador 1</label>
            <select value={p1} onChange={(e) => setP1(e.target.value)} style={{ width: "100%" }}>
              <option value="">-- Selecione --</option>
              {players.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="muted">Jogador 2</label>
            <select value={p2} onChange={(e) => setP2(e.target.value)} style={{ width: "100%" }}>
              <option value="">-- Selecione --</option>
              {players.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {p1 && p2 && p1 !== p2 && (
        <>
          <div className="grid">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Histórico de Rating</h3>
              <canvas id="compareChart" height={180} />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Métricas</h3>
              {metrics ? (
                <table>
                  <tbody>
                    <tr>
                      <td>Jogos em comum</td>
                      <td className="right">{metrics.common}</td>
                    </tr>
                    <tr>
                      <td>Vitórias {selectedP1?.name}</td>
                      <td className="right">{metrics.wins1}</td>
                    </tr>
                    <tr>
                      <td>Vitórias {selectedP2?.name}</td>
                      <td className="right">{metrics.wins2}</td>
                    </tr>
                    <tr>
                      <td>Empates</td>
                      <td className="right">{metrics.draws}</td>
                    </tr>
                    <tr>
                      <td>Média de pontos {selectedP1?.name}</td>
                      <td className="right">{metrics.avg1.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Média de pontos {selectedP2?.name}</td>
                      <td className="right">{metrics.avg2.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div className="muted">Carregando métricas...</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}