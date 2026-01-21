"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Player = { id: string; name: string };

// Initialise a client‑side Supabase client for admin actions.  Only
// client‑accessible environment variables (prefixed with
// NEXT_PUBLIC_) are exposed at build time.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function AdminPage() {
  const [logged, setLogged] = useState(false);
  const [msg, setMsg] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [newPlayer, setNewPlayer] = useState("");
  const [matchDate, setMatchDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [points, setPoints] = useState<Record<string, string>>({});
  // List of existing matches for editing
  const [matches, setMatches] = useState<any[]>([]);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);

  // Load players from the database
  async function loadPlayers() {
    const { data } = await supabase.from("players").select("id,name").order("name");
    setPlayers((data as Player[]) || []);
  }

  useEffect(() => {
    loadPlayers();
  }, []);

  // When the admin logs in, load existing matches
  useEffect(() => {
    if (logged) {
      loadMatches();
    }
  }, [logged]);

  // Fetch all matches via the admin API
  async function loadMatches() {
    const res = await fetch("/api/admin/list-matches");
    if (res.ok) {
      const j = await res.json();
      setMatches(j.matches || []);
    }
  }

  // Attempt an admin login by posting to the login API.  On success
  // it sets the `logged` state, reloads players and matches and shows
  // a success message.  On failure it shows an error message.
  async function login() {
    setMsg("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      setLogged(true);
      setMsg("Autenticado");
      loadPlayers();
      loadMatches();
    } else {
      setMsg("Credenciais inválidas");
    }
  }

  // Create a new player
  async function addPlayer() {
    setMsg("");
    const res = await fetch("/api/admin/add-player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newPlayer }),
    });
    if (res.ok) {
      setNewPlayer("");
      loadPlayers();
      setMsg("Player adicionado");
    } else {
      const j = await res.json();
      setMsg(j.error || "Erro ao adicionar player");
    }
  }

  // Register a new match
  async function addMatch() {
    setMsg("");
    const entries = selected.map((id) => ({
      playerId: id,
      points: Number(points[id]),
    }));
    const res = await fetch("/api/admin/add-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchDate, entries }),
    });
    if (res.ok) {
      setSelected([]);
      setPoints({});
      setMsg("Partida salva");
      loadMatches();
    } else {
      const j = await res.json();
      setMsg(j.error || "Erro ao salvar partida");
    }
  }

  // Update an existing match
  async function updateMatch() {
    if (!editingMatchId) return;
    setMsg("");
    const entries = selected.map((id) => ({
      playerId: id,
      points: Number(points[id]),
    }));
    const res = await fetch("/api/admin/update-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId: editingMatchId, matchDate, entries }),
    });
    if (res.ok) {
      setEditingMatchId(null);
      setSelected([]);
      setPoints({});
      setMatchDate(new Date().toISOString().slice(0, 10));
      setMsg("Partida atualizada");
      loadMatches();
    } else {
      const j = await res.json();
      setMsg(j.error || "Erro ao atualizar partida");
    }
  }

  // Prefill the form when editing a match
  function editMatch(match: any) {
    setEditingMatchId(match.id.toString());
    setMatchDate(match.match_date);
    const ids = match.match_entries.map((e: any) => e.player_id);
    setSelected(ids);
    const pts: Record<string, string> = {};
    match.match_entries.forEach((e: any) => {
      pts[e.player_id] = e.points.toString();
    });
    setPoints(pts);
    setMsg("");
  }

  // Cancel editing and reset the form
  function cancelEdit() {
    setEditingMatchId(null);
    setSelected([]);
    setPoints({});
    setMatchDate(new Date().toISOString().slice(0, 10));
    setMsg("");
  }

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Admin</h2>
          <div className="muted">Protegido por login/senha (cookies de sessão)</div>
        </div>
        <a href="/" className="muted">
          Dashboard
        </a>
      </div>

      {!logged && (
        <div className="card">
          <input
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" onClick={login}>
            Entrar
          </button>
          <div className="muted">{msg}</div>
        </div>
      )}

      {logged && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Novo jogador</h3>
            <input
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              placeholder="Nome do jogador"
            />
            <button className="primary" onClick={addPlayer}>
              Adicionar
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>
              {editingMatchId ? `Editar partida #${editingMatchId}` : "Registrar partida"}
            </h3>
            <input
              type="date"
              value={matchDate}
              onChange={(e) => setMatchDate(e.target.value)}
            />
            <div className="muted" style={{ marginTop: 8 }}>
              Selecione jogadores e defina os pontos
            </div>
            <select
              multiple
              value={selected}
              onChange={(e) =>
                setSelected(Array.from(e.target.selectedOptions).map((o) => o.value))
              }
              style={{ width: "100%", height: 180, marginTop: 8 }}
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 12 }}>
              {selected.length === 0 && <div className="muted">Nenhum jogador selecionado</div>}
              {selected.map((id) => {
                const player = players.find((p) => p.id === id);
                return (
                  <div key={id} className="row">
                    <span style={{ flex: 1 }}>{player?.name}</span>
                    <input
                      placeholder="Pontos"
                      value={points[id] || ""}
                      onChange={(e) =>
                        setPoints((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <button
              className="primary"
              onClick={editingMatchId ? updateMatch : addMatch}
              style={{ marginTop: 12 }}
            >
              {editingMatchId ? "Atualizar partida" : "Salvar partida"}
            </button>
            {editingMatchId && (
              <button className="secondary" onClick={cancelEdit} style={{ marginLeft: 8 }}>
                Cancelar edição
              </button>
            )}
            <div className="muted">{msg}</div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Partidas existentes</h3>
            {matches.length === 0 && <div className="muted">Nenhuma partida cadastrada</div>}
            {matches.map((match) => (
              <div key={match.id} style={{ marginBottom: 8 }}>
                <div className="row" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <strong>{match.match_date}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {match.match_entries
                        .map((e: any) => `${e.players?.name || e.player_id}: ${e.points}`)
                        .join(" | ")}
                    </div>
                  </div>
                  <button onClick={() => editMatch(match)}>Editar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}