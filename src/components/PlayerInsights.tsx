// Client component that fetches and displays insights for a specific player.
//
// Usage: <PlayerInsights playerId={player.id} />
//
// The component calls the `/api/insights/player` endpoint, displays a
// loading indicator, then renders a summary paragraph and optionally
// detailed statistics.

"use client";

import { useEffect, useState } from 'react';

interface Props {
  playerId: string;
  /**
   * Number of recent matches to analyse (optional).  Defaults to 10.
   */
  recentMatches?: number;
}

interface PlayerStats {
  name: string;
  rating: number;
  games: number;
  avg_points: number;
  win_pct: number;
  delta_last_10: number;
  total_points: number;
  [key: string]: any;
}

interface HistoryEntry {
  match_index: number;
  rating_after: number;
  delta: number;
  created_at: string;
}

export default function PlayerInsights({ playerId, recentMatches = 10 }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInsights() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/insights/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId, recentMatches }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
        setSummary(data.summary);
        setStats(data.stats);
        setHistory(data.history);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchInsights();
  }, [playerId, recentMatches]);

  if (loading) {
    return <p>Gerando resumo do jogador...</p>;
  }
  if (error) {
    return <p style={{ color: 'red' }}>Erro: {error}</p>;
  }
  return (
    <div className="player-insights">
      {summary && (
        <p className="player-summary" style={{ whiteSpace: 'pre-wrap' }}>{summary}</p>
      )}
      {stats && (
        <ul className="player-stats">
          <li><strong>Média de pontos:</strong> {stats.avg_points?.toFixed?.(2)}</li>
          <li><strong>Porcentagem de vitórias:</strong> {(stats.win_pct * 100).toFixed(1)}%</li>
          <li><strong>Delta das últimas 10 partidas:</strong> {stats.delta_last_10}</li>
          <li><strong>Total de jogos:</strong> {stats.games}</li>
        </ul>
      )}
    </div>
  );
}