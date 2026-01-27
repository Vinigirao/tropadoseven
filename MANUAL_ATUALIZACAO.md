# Atualização: substituindo o ChatGPT por uma IA gratuita

Este manual explica como atualizar o projeto de rating de **7 Wonders** para utilizar um provedor de IA gratuito em vez da API paga da OpenAI (ChatGPT).  A nova implementação utiliza a **Hugging Face Inference API**, mas você pode adaptar para outro serviço gratuito seguindo as mesmas diretrizes.

## 1. Pré‑requisitos

1. **Conta na Hugging Face** – crie uma conta em [huggingface.co](https://huggingface.co/) para obter um token de acesso gratuito.  Este token permite utilizar a API de inferência para modelos open source.
2. **API token** – após criar a conta, vá até *Settings → Access Tokens* e gere um token com permissão **“read”**.  Copie este token; ele será usado nas variáveis de ambiente.
3. **Node.js & npm** – instalados localmente para rodar o projeto.  Baixe em [nodejs.org](https://nodejs.org/).

## 2. Variáveis de ambiente

Além das variáveis já existentes (chaves do Supabase e credenciais de administrador), são necessárias duas novas variáveis no arquivo `.env.local`:

```
# token da API de inferência da Hugging Face (obrigatório)
HF_API_TOKEN="seu_token_huggingface"

# identificador do modelo usado para gerar textos (opcional)
HF_MODEL_ID="mistralai/Mistral-7B-Instruct-v0.1"
```

O valor de `HF_MODEL_ID` define qual modelo de linguagem será utilizado.  Por padrão, o código usa o modelo `mistralai/Mistral-7B-Instruct-v0.1`, que é gratuito para inferência.  Você pode substituí‑lo por outro modelo instruído (por exemplo, `tiiuae/falcon-7b-instruct` ou `openchat/openchat-3.5`) desde que o modelo esteja disponível na Hugging Face Hub.

⚠️ **Nunca exponha tokens ou chaves secretas em código público.**  Defina as variáveis somente no ambiente de execução (por exemplo, no painel de variáveis da Vercel ou no arquivo `.env.local` ignorado pelo Git).

## 3. Instalação das dependências

O projeto continua utilizando Next.js e Supabase.  Após clonar ou atualizar o repositório, instale as dependências:

```bash
npm install
```

Nenhuma dependência adicional é necessária, pois o `fetch` nativo do Next.js é utilizado para chamar a API da Hugging Face.

## 4. Executando em desenvolvimento

Preencha o arquivo `.env.local` com as chaves do Supabase, credenciais de administrador e as novas variáveis `HF_API_TOKEN` e `HF_MODEL_ID`.  Em seguida, inicie o servidor de desenvolvimento:

```bash
npm run dev
```

O dashboard e o painel administrativo funcionarão normalmente.  Quando você acessar as páginas de insights gerais ou do jogador, o texto descritivo será gerado usando o modelo definido nas variáveis de ambiente.  Esse texto será atualizado sempre que as rotas `/api/insights/general` ou `/api/insights/player` forem chamadas e os dados subjacentes tiverem mudado.

## 5. Como funciona a nova integração

Os arquivos `src/app/api/insights/general/route.ts` e `src/app/api/insights/player/route.ts` foram modificados para importar a função `generateText` a partir de `src/lib/free_ai.ts`.  Essa função é um pequeno cliente para a Hugging Face Inference API.  Ela envia o *prompt* gerado pelo código para o modelo definido e retorna o texto de resposta.

A assinatura da função é:

```ts
// Importação relativa do helper de IA gratuito
import { generateText } from '../../../../lib/free_ai';

const resumo = await generateText(prompt, {
  maxTokens: 400,      // número máximo de tokens na resposta
  temperature: 0.2,    // controle de criatividade
});
```

Internamente, a função lê `HF_API_TOKEN` e `HF_MODEL_ID` das variáveis de ambiente, monta a requisição HTTP e trata erros de forma amigável.

## 6. Opções de modelos e custos

A Hugging Face oferece uma cota gratuita para inferência de modelos públicos.  Para cargas maiores, considere hospedar um modelo localmente com [`Ollama`](https://github.com/ollama/ollama) ou [`Text Generation Inference`](https://github.com/huggingface/text-generation-inference) e ajustar a função `generateText` para enviar requisições ao seu servidor local (por exemplo, `http://localhost:11434/api/generate`).

Modelos menores (como `facebook/bart-large-cnn` ou `google/pegasus-cnn_dailymail`) podem ser usados se a geração de resumos simples for suficiente.  Para resumos mais elaborados, prefira modelos instruídos como os da família Mistral ou Llama.

## 7. Deploy no Vercel

Ao implantar no Vercel, defina as variáveis `HF_API_TOKEN` e `HF_MODEL_ID` em **Settings → Environment Variables** do projeto, além das demais chaves do Supabase.  Em seguida, faça o deploy normalmente.  A nova rota de insights utilizará a IA gratuita.

## 8. Considerações finais

Esta atualização permite gerar resumos de partidas e de jogadores sem custos adicionais.  A qualidade do texto depende do modelo escolhido e poderá ser diferente da resposta da OpenAI.  Ajuste o *prompt*, o modelo e os parâmetros (`temperature`, `maxTokens`) conforme a necessidade.

Não esqueça de verificar periodicamente se a cota da Hugging Face está sendo respeitada e, se necessário, adotar uma solução local para total independência de provedores externos.