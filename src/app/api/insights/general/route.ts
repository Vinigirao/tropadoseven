// API route for generating general dashboard insights using OpenAI.
//
// This endpoint summarises recent matches across all players.  It
// aggregates statistics (e.g. winners, average scores, rating changes)
// from Supabase and asks the OpenAI model to produce a human‑readable
// report.  Use POST with a JSON body `{ recentMatches: number }` to
// control how many recent matches to analyse.  Defaults to 10.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import openai from '@/lib/openai';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase configuration missing');
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface RequestBody {
  recentMatches?: number;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const recentMatches = Math.min(Math.max(body.recentMatches ?? 10, 1), 50);
  try {
    // Fetch the most recent match IDs.
    const { data: matches, error: matchesError } = await supabase
      .from('matches')
      .select('id, match_date')
      .order('match_date', { ascending: false })
      .limit(recentMatches);
    if (matchesError) throw matchesError;
    const matchIds = matches?.map((m) => m.id) ?? [];
    if (matchIds.length === 0) {
      return NextResponse.json({ summary: 'Nenhuma partida encontrada.', details: {} });
    }
    // Fetch match entries joined with player names.
    const { data: entries, error: entriesError } = await supabase
      .from('match_entries')
      .select('match_id, player_id, points, map, players(name)')
      .in('match_id', matchIds);
    if (entriesError) throw entriesError;
    // Fetch rating deltas for the same matches.
    const { data: deltas, error: deltasError } = await supabase
      .from('rating_history')
      .select('match_id, player_id, delta')
      .in('match_id', matchIds);
    if (deltasError) throw deltasError;
    // Aggregate data
    interface PlayerAgg {
      name: string;
      totalPoints: number;
      matches: number;
      wins: number;
      ratingChange: number;
    }
    const playerMap: Record<string, PlayerAgg> = {};
    // Map of match winners to highlight standout players
    const matchResults: Array<{ matchId: string; date: string; winners: string[]; topScore: number }> = [];
    // Group entries by match
    const entriesByMatch: Record<string, Array<{ player_id: string; name: string; points: number }>> = {};
    entries?.forEach((e) => {
      const name = (e as any).players.name as string;
      if (!playerMap[e.player_id]) {
        playerMap[e.player_id] = { name, totalPoints: 0, matches: 0, wins: 0, ratingChange: 0 };
      }
      playerMap[e.player_id].totalPoints += Number(e.points);
      playerMap[e.player_id].matches += 1;
      if (!entriesByMatch[e.match_id]) entriesByMatch[e.match_id] = [];
      entriesByMatch[e.match_id].push({ player_id: e.player_id, name, points: Number(e.points) });
    });
    // Determine winners per match
    for (const matchId of matchIds) {
      const matchEntryList = entriesByMatch[matchId] ?? [];
      let topScore = -Infinity;
      matchEntryList.forEach((entry) => {
        if (entry.points > topScore) topScore = entry.points;
      });
      const winners = matchEntryList
        .filter((entry) => entry.points === topScore)
        .map((entry) => entry.name);
      // update wins count (split half point for ties)
      matchEntryList.forEach((entry) => {
        if (entry.points === topScore) {
          const share = winners.length > 1 ? 0.5 : 1;
          playerMap[entry.player_id].wins += share;
        }
      });
      // store match results for context
      const match = matches?.find((m) => m.id === matchId);
      matchResults.push({ matchId, date: (match?.match_date as any) ?? '', winners, topScore });
    }
    // Sum rating changes per player
    deltas?.forEach((d) => {
      if (playerMap[d.player_id]) {
        playerMap[d.player_id].ratingChange += Number(d.delta);
      }
    });
    // Build an array summarising each player
    const playerSummaries = Object.entries(playerMap).map(([id, agg]) => {
      return {
        id,
        ...agg,
        avgPoints: agg.totalPoints / Math.max(agg.matches, 1),
        winPct: agg.wins / Math.max(agg.matches, 1),
      };
    });
    // Compose a prompt for OpenAI to summarise the dashboard.  We
    // include a compact JSON of player summaries and recent match results.
    const prompt = `Você é um analista de dados para um ranking de 7 Wonders.\n` +
      `Aqui estão as estatísticas agregadas dos jogadores nas últimas ${matchIds.length} partidas: ${JSON.stringify(playerSummaries)}.\n` +
      `E os resultados das partidas (data, pontuação máxima e vencedores): ${JSON.stringify(matchResults)}.\n\n` +
      `Escreva um relatório em português que destaque quem se destacou, quem teve maior variação positiva ou negativa de rating, ` +
      `e qualquer tendência interessante (por exemplo, jogadores em alta ou em baixa). Compare médias de pontos e percentuais de vitória. ` +
      `Não invente números que não estão nos dados. Use uma linguagem amigável e objetiva.`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.2,
    });
    const summary = completion.choices?.[0]?.message?.content?.trim() ?? '';
    return NextResponse.json({ summary, players: playerSummaries, matches: matchResults });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Erro ao gerar insights' }, { status: 500 });
  }
}