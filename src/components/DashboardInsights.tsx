// Client component that fetches and displays general dashboard insights.
//
// Usage: <DashboardInsights recentMatches={10} />
//
// The component calls `/api/insights/general` to obtain a summary of
// recent matches and players.  It displays the summary and simple
// tables for players and matches.

"use client";

import { useEffect, useState } from 'react';

interface Props {
  /** Number of recent matches to analyse. Defaults to 10. */
  recentMatches?: number;
}

interface PlayerSummary {
  id: string;
  name: string;
  totalPoints: number;
  matches: number;
  wins: number;
  ratingChange: number;
  avgPoints: number;
  winPct: number;
}
interface MatchResult {
  matchId: string;
  date: string;
  winners: string[];
  topScore: number;
}

export default function DashboardInsights({ recentMatches = 10 }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [matches, setMatches] = useState<MatchResult[]>([]);

  useEffect(() => {
    async function fetchData() {
      try {
        setError(null);
        setLoading(true);
        const res = await fetch('/api/insights/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recentMatches }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
        setSummary(data.summary);
        setPlayers(data.players);
        setMatches(data.matches);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [recentMatches]);

  if (loading) return <p>Analisando partidas recentes...</p>;
  if (error) return <p style={{ color: 'red' }}>Erro: {error}</p>;

  return (
    <div className="dashboard-insights">
      {summary && <p className="dashboard-summary" style={{ whiteSpace: 'pre-wrap' }}>{summary}</p>}
      {players.length > 0 && (
        <div>
          <h3>Jogadores em Destaque</h3>
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Média de pontos</th>
                <th>% Vitórias</th>
                <th>Variação de rating</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.avgPoints.toFixed(2)}</td>
                  <td>{(p.winPct * 100).toFixed(1)}%</td>
                  <td>{p.ratingChange >= 0 ? `+${p.ratingChange.toFixed(1)}` : p.ratingChange.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {matches.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Últimas partidas</h3>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Pontuação Máxima</th>
                <th>Vencedores</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.matchId}>
                  <td>{m.date}</td>
                  <td>{m.topScore}</td>
                  <td>{m.winners.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}