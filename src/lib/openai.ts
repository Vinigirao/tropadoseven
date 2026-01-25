// This module initializes the OpenAI client using the official SDK.
// It reads the API key from the environment (OPENAI_API_KEY) and
// exports a singleton instance.  See the OpenAI quick‑start docs for
// details on generating and exporting an API key【3978948754125†L184-L210】.

import OpenAI from "openai";

// Create a single OpenAI client. The API key must be provided via
// `OPENAI_API_KEY` in your environment (e.g. a `.env.local` file). This
// ensures the key is not bundled into the client bundle.  Do not prefix
// the variable with `NEXT_PUBLIC_` because that would expose it to the
// browser【211584439296609†L69-L78】.
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default client;