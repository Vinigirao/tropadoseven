"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Chart from "chart.js/auto";

type DashRow = {
  player_id: string;
  name: string;
  rating: number;
  games: number;
  avg_points: number;
  win_pct: number;
  delta_last_10: number;
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

  // Load ranking data
  async function loadDashboard() {
    const { data, error } = await supabase
      .from("v_dashboard_players")
      .select("*")
      .order("rating", { ascending: false });
    if (!error && data) {
      setRows(data as unknown as DashRow[]);
      setSelectedPlayers(data.slice(0, 5).map((d: any) => d.player_id));
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
        <a href="/admin" className="muted">
          Admin
        </a>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Nenhuma partida registrada ainda.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.player_id}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td className="right">
                    <b>{Math.round(r.rating)}</b>
                  </td>
                  <td className="right">{(r.win_pct * 100).toFixed(1)}%</td>
                  <td className="right">{Number(r.avg_points).toFixed(1)}</td>
                  <td className="right">{r.games}</td>
                  <td className="right">{Number(r.delta_last_10).toFixed(1)}</td>
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
        </div>
      </div>
    </div>
  );
}