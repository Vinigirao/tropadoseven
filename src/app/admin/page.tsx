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
  // Map selection per player for the current match.  Each player must
  // choose a unique wonder board.
  const [mapSelections, setMapSelections] = useState<Record<string, string>>({});

  // List of available wonder boards (mapas) including the base game and the Leaders expansion.
  const availableMaps = [
    "Alexandria",
    "Babylon",
    "Ephesus",
    "Giza",
    "Halikarnassus",
    "Olympia",
    "Rhodes",
    "Roma",
    "Abu Simbel"
  ];
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
    // Validate that all players have points and maps
    const entries = selected.map((id) => ({
      playerId: id,
      points: Number(points[id]),
      map: mapSelections[id],
    }));
    // Ensure no empty map values
    if (entries.some((e) => !e.map)) {
      setMsg("Todos os jogadores precisam ter um mapa definido");
      return;
    }
    // Ensure no duplicate maps
    const usedMaps = entries.map((e) => e.map);
    const unique = new Set(usedMaps);
    if (unique.size !== usedMaps.length) {
      setMsg("Jogadores não podem repetir o mesmo mapa na mesma partida");
      return;
    }
    const res = await fetch("/api/admin/add-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchDate, entries }),
    });
    if (res.ok) {
      setSelected([]);
      setPoints({});
      setMapSelections({});
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
      map: mapSelections[id],
    }));
    // Validate maps
    if (entries.some((e) => !e.map)) {
      setMsg("Todos os jogadores precisam ter um mapa definido");
      return;
    }
    const usedMaps = entries.map((e) => e.map);
    const unique = new Set(usedMaps);
    if (unique.size !== usedMaps.length) {
      setMsg("Jogadores não podem repetir o mesmo mapa na mesma partida");
      return;
    }
    const res = await fetch("/api/admin/update-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId: editingMatchId, matchDate, entries }),
    });
    if (res.ok) {
      setEditingMatchId(null);
      setSelected([]);
      setPoints({});
      setMapSelections({});
      setMatchDate(new Date().toISOString().slice(0, 10));
      setMsg("Partida atualizada");
      loadMatches();
    } else {
      const j = await res.json();
      setMsg(j.error || "Erro ao atualizar partida");
    }
  }

  // Delete a match by ID
  async function deleteMatch(matchId: string) {
    // Second layer of protection: require the user to type the word
    // "excluir" to confirm the deletion.  Using a prompt here avoids
    // adding extra UI components while still ensuring intentional
    // actions.
    const input = window.prompt(
      'Digite "excluir" para confirmar a exclusão da partida',
    );
    if (input !== "excluir") {
      // If the user cancels or types something else, abort the deletion
      setMsg("Exclusão cancelada");
      return;
    }
    setMsg("");
    const res = await fetch("/api/admin/delete-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId }),
    });
    if (res.ok) {
      setMsg("Partida deletada");
      // Reload matches to reflect removal
      loadMatches();
    } else {
      const j = await res.json();
      setMsg(j.error || "Erro ao deletar partida");
    }
  }

  // Prefill the form when editing a match
  function editMatch(match: any) {
    setEditingMatchId(match.id.toString());
    setMatchDate(match.match_date);
    const ids = match.match_entries.map((e: any) => e.player_id);
    setSelected(ids);
    const pts: Record<string, string> = {};
    const maps: Record<string, string> = {};
    match.match_entries.forEach((e: any) => {
      pts[e.player_id] = e.points.toString();
      maps[e.player_id] = e.map || "";
    });
    setPoints(pts);
    setMapSelections(maps);
    setMsg("");
  }

  // Cancel editing and reset the form
  function cancelEdit() {
    setEditingMatchId(null);
    setSelected([]);
    setPoints({});
    setMapSelections({});
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
                      style={{ width: "80px", marginRight: 8 }}
                    />
                    {/* Map selection for each player.  Filter out maps already chosen by other players (except this player's current selection) */}
                    <select
                      value={mapSelections[id] || ""}
                      onChange={(e) =>
                        setMapSelections((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      style={{ flex: 1 }}
                    >
                      <option value="" disabled>
                        Mapa
                      </option>
                      {availableMaps
                        .filter((m) => {
                          // Show the option if it hasn't been selected by another player or is the current selection
                          const others = Object.entries(mapSelections)
                            .filter(([pid]) => pid !== id)
                            .map(([, val]) => val);
                          return !others.includes(m) || mapSelections[id] === m;
                        })
                        .map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                    </select>
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
                        .map((e: any) => {
                          const name = e.players?.name || e.player_id;
                          const pts = e.points;
                          const mp = e.map ? ` (${e.map})` : "";
                          return `${name}: ${pts}${mp}`;
                        })
                        .join(" | ")}
                      {"  "}
                      {/* Show total points for the match */}
                      <span style={{ fontStyle: "italic" }}>
                        Total: {match.match_entries.reduce((sum: number, e: any) => sum + Number(e.points), 0)}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => editMatch(match)}>Editar</button>
                  <button
                    onClick={() => deleteMatch(match.id.toString())}
                    className="secondary"
                    style={{ marginLeft: 8 }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
