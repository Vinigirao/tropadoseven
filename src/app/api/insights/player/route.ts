// API route for generating per‑player insights using the OpenAI API.
//
// This route fetches aggregated statistics for the given player from
// Supabase and passes them to OpenAI to generate a natural‑language
// summary of the player's recent performance.  The response includes
// both the raw statistics and a textual summary that can be shown in
// the UI.  Environment variables for Supabase (`NEXT_PUBLIC_SUPABASE_URL`
// and `SUPABASE_SERVICE_ROLE_KEY`) and OpenAI (`OPENAI_API_KEY`) must
// be configured for this endpoint to function correctly.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// Import the free AI helper instead of OpenAI.
import { generateText } from '../../../../lib/free_ai';

// Initialise a Supabase client using a service role key.  The service
// role key allows read access to views like v_dashboard_players and
// v_rating_history_with_order.  Do **not** expose this key to the
// browser.  See Supabase docs for details.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase configuration missing');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface RequestBody {
  playerId: string;
  /**
   * Number of recent matches to include in the summary.  Defaults to
   * 10.  Larger values will increase the prompt size and cost.  Must
   * be between 5 and 50.
   */
  recentMatches?: number;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { playerId, recentMatches = 10 } = body;
  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }
  try {
    // Fetch aggregated stats for the player from the dashboard view.  This
    // view is defined in supabase_schema.sql and calculates games played,
    // average points, win percentage, rating, etc.
    const { data: stats, error: statsError } = await supabase
      .from('v_dashboard_players')
      .select('*')
      .eq('player_id', playerId)
      .single();
    if (statsError) throw statsError;

    // Fetch rating history ordered by match index.  We limit to the
    // requested number of recent entries.
    const { data: history, error: historyError } = await supabase
      .from('v_rating_history_with_order')
      .select('match_index,rating_after,delta,created_at')
      .eq('player_id', playerId)
      .order('match_index', { ascending: true })
      .limit(recentMatches);
    if (historyError) throw historyError;

    // A guard to constrain the style of the generated text.  This ensures
    // the output is plain text and remains concise.  See general route for details.
    const styleGuard = `\nResponda somente em texto simples.\n` +
      `Não use markdown, negrito, listas ou emojis.\n` +
      `quero que voce humilhe players ruins que estao mandando mal e exalte os bons e vanglorize.\n` +
      `use frazes do tipo "tra precisando treinar hein" ou "tu devia ta muito louco nessa ultima partida".\n` +
      `seja da zoeira, faca piadas, trocadilhos\n` +
      `voce vai mandar a real na lata para o player\n` +
      `Resumo curto 1 paragrafo\n`;

    // Compose a prompt for the AI helper.  We prepend the styleGuard so that
    // the model does not use markdown formatting and returns a brief summary.  The
    // prompt provides the raw JSON statistics and asks for a Portuguese narrative.
    const prompt = `${styleGuard}\n` +
      `Você é um assistente que analisa estatísticas de partidas do jogo 7 Wonders e descreve o desempenho de um jogador.\n\n` +
      `Dados do jogador (JSON): ${JSON.stringify(stats)}\n` +
      `Histórico de rating (últimas ${history?.length ?? 0} partidas, JSON): ${JSON.stringify(history)}\n\n` +
      `Com base nesses dados, escreva um resumo em português do desempenho do jogador: destaque pontos médios, porcentagem de vitórias, tendência recente do rating e qualquer melhora ou queda significativa. ` +
      `Compare com a média dos outros jogadores quando possível. Não invente números que não estejam nos dados. Retorne apenas o texto do resumo, sem colunas de JSON.`;

    // Generate the summary using the free AI helper.  Lower maxTokens and temperature
    // to produce a more concise, less verbose response.
    const summary = await generateText(prompt, {
      maxTokens: 150,
      temperature: 0.1,
    });
    return NextResponse.json({
      summary,
      stats,
      history,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message || 'Erro ao gerar insights' }, { status: 500 });
  }
}
