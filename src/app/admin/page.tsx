"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Player = { id: string; name: string };

// Client‑side Supabase client for admin actions
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

  // Load players on mount
  async function loadPlayers() {
    const { data } = await supabase.from("players").select("id,name").order("name");
    setPlayers((data as Player[]) || []);
  }

  useEffect(() => {
    loadPlayers();
  }, []);

  // Login handler sets session via API route
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
    } else {
      setMsg("Credenciais inválidas");
    }
  }

  // Add a new player via admin API
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

  // Save a match with selected players and their points
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
    } else {
      const j = await res.json();
      setMsg(j.error || "Erro ao salvar partida");
    }
  }

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Admin</h2>
          <div className="muted">
            Protegido por login/senha (cookies de sessão)
          </div>
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
            <h3 style={{ marginTop: 0 }}>Registrar partida</h3>
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
                setSelected(
                  Array.from(e.target.selectedOptions).map((o) => o.value),
                )
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
              {selected.length === 0 && (
                <div className="muted">Nenhum jogador selecionado</div>
              )}
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
            <button className="primary" onClick={addMatch} style={{ marginTop: 12 }}>
              Salvar partida
            </button>
            <div className="muted">{msg}</div>
          </div>
        </>
      )}
    </div>
  );
}