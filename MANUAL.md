# Guia de implementação do sistema de rating e agregador

Este manual explica passo a passo como preparar e hospedar o sistema de rating para **7 Wonders** construído em **Next.js** com **Supabase**. O objetivo é que qualquer pessoa consiga reproduzir o projeto, configurar as credenciais e publicar o dashboard e painel administrativo online.

## 1. Pré‑requisitos e serviços utilizados

Para implementar e hospedar o agregador você precisará de contas nos seguintes serviços:

1. **Supabase** – serviço de banco de dados PostgreSQL gerenciado, com autenticação e SQL editor integrado. Crie uma conta em [supabase.com](https://supabase.com/) se ainda não tiver.
2. **GitHub** – repositório para versionar o código e servir de fonte para o deploy. Crie uma conta em [github.com](https://github.com/).
3. **Vercel** – plataforma de hospedagem para projetos Next.js. Crie uma conta em [vercel.com](https://vercel.com/).
4. **Node.js & npm** – instalados localmente para rodar o projeto e gerenciar dependências. Baixe em [nodejs.org](https://nodejs.org/).

## 2. Configurando o banco de dados no Supabase

### 2.1 Criar um projeto
1. Acesse o painel do Supabase e clique em **New project**. Escolha um nome e crie uma senha para o banco (anote, pois será usada em operações avançadas).
2. Após a criação, navegue até **Project Settings → API** e copie os seguintes valores:
   - **Project URL**: URL base usada pelo cliente Supabase.
   - **Anon public key** (`anon key` ou `publishable` key): chave pública para acessar o banco a partir do frontend. A documentação do Supabase recomenda renomear o arquivo `.env.example` para `.env.local` e preencher `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` com esses valores【581933999788597†L279-L324】.
   - **Service role key** (`service_role key`): chave com privilégios elevados usada apenas no servidor (rotas API). **Nunca expor no frontend**.

### 2.2 Criar o esquema do banco

Supabase fornece um **editor SQL** no Studio para executar scripts. Para utilizá‑lo:

1. Abra o projeto no Supabase e clique em **SQL editor**.
2. Clique em **New Query**【763559808751294†L183-L192】.
3. Cole o conteúdo do arquivo `supabase_schema.sql` (incluído neste projeto) que cria as tabelas `players`, `matches`, `match_entries`, `rating_history` e as views `v_player_current_rating` e `v_dashboard_players`.
4. Clique em **Run** ou pressione **Ctrl+Enter** para executar【763559808751294†L183-L192】. O script criará automaticamente o esquema necessário.

As views calculam o rating atual de cada jogador e estatísticas agregadas como número de partidas, média de pontos, percentual de vitórias e variação de rating nas últimas 10 partidas. Portanto, nenhum outro ajuste é necessário no banco.

### 2.3 Regras de segurança (opcional)

O projeto utiliza a chave `service_role` apenas em rotas API autenticadas pelo administrador, portanto não é necessário configurar Row Level Security neste exemplo. Caso queira reforçar a segurança, habilite Row Level Security nas tabelas e crie policies de `SELECT` públicas e policies de `INSERT`/`UPDATE` apenas para usuários autenticados.

## 3. Preparando o código localmente

1. Faça o download do repositório deste projeto (ou clone usando Git). O código está estruturado em uma pasta `aggregator_project` contendo um aplicativo Next.js configurado com TypeScript.
2. Abra um terminal na raiz do projeto e instale as dependências:
   ```bash
   npm install
   ```
3. Copie o arquivo de exemplo `.env.local.example` para `.env.local` (neste repositório o exemplo já foi incluído no manual) e preencha as variáveis:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL copiada do Supabase.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key (publishable key)【581933999788597†L279-L324】.
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key (usada apenas no servidor).
   - `ADMIN_USERNAME` e `ADMIN_PASSWORD` = credenciais únicas para acessar o painel admin.
   - `ADMIN_SESSION_SECRET` = string aleatória longa para assinar o cookie de sessão.

   Variáveis definidas sem prefixo `NEXT_PUBLIC_` ficam acessíveis **somente no servidor**, enquanto chaves iniciadas com `NEXT_PUBLIC_` são expostas ao browser【694929286118163†L94-L171】.

4. Execute o servidor de desenvolvimento para testar localmente:
   ```bash
   npm run dev
   ```
   Acesse `http://localhost:3000` para visualizar o dashboard. O painel de administração está em `/admin` e exigirá o usuário e senha definidos.

## 4. Estrutura do projeto

- `package.json`: configura dependências (Next.js, React, Supabase, chart.js).
- `next.config.js` e `tsconfig.json`: ajustes de compilação.
- `src/lib/`: utilitários de autenticação (`auth.ts`), cálculo de rating (`rating.ts`) e cliente Supabase (`supabaseServer.ts`).
- `src/app/`: páginas do Next.js. A página raiz (`page.tsx`) mostra o dashboard com ranking e gráfico; `/admin/page.tsx` implementa o painel administrativo com login, cadastro de jogadores e registro de partidas. Rotas API (`/api/...`) gerenciam login, logout e operações de banco.
- `supabase_schema.sql`: script SQL para criar tabelas e views.

## 5. Publicando no GitHub

Para facilitar o deploy no Vercel, versionamos o projeto em um repositório Git. Se você ainda não iniciou um repositório, siga estes passos no terminal na pasta `aggregator_project`:

```bash
git init
git add .
git commit -m "Projeto inicial do agregador 7 Wonders"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/NOME_DO_REPO.git
git push -u origin main
```

Substitua `SEU_USUARIO` e `NOME_DO_REPO` pelo usuário e nome do repositório GitHub. Isso criará o repositório com o código.

## 6. Configurando variáveis de ambiente na Vercel

O Vercel permite definir variáveis de ambiente no painel do projeto. Segundo a documentação, você deve abrir seu projeto na Vercel, ir até **Settings → Environment Variables**, informar **Name** e **Value**, escolher para quais ambientes (Production/Preview/Development) os valores se aplicam, clicar em **Save** e então redeployar o projeto【684807521260048†L1465-L1503】. Estas variáveis ficam criptografadas em repouso【694929286118163†L94-L171】.

Crie as seguintes variáveis na Vercel (valores iguais aos definidos em `.env.local`):

| Nome | Valor | Observação |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase | prefixo `NEXT_PUBLIC_` para ser lido no navegador【694929286118163†L94-L171】 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` (publishable) | acesso público ao banco【581933999788597†L279-L324】 |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` | **não utilize prefixo**, pois deve ficar somente no servidor |
| `ADMIN_USERNAME` | usuário de admin | qualquer valor definindo credencial |
| `ADMIN_PASSWORD` | senha de admin | defina uma senha forte |
| `ADMIN_SESSION_SECRET` | segredo longo | para assinar cookie de sessão |

Após salvar as variáveis, clique em **Deploy** para aplicar as alterações.

## 7. Publicando no Vercel

1. No painel da Vercel, clique em **New Project** e importe o repositório GitHub que contém o código.
2. A Vercel detectará automaticamente o framework **Next.js**. Não altere o comando de build nem a pasta de saída.
3. No passo **Environment Variables**, adicione as variáveis conforme descrito na seção anterior.
4. Clique em **Deploy**. A Vercel irá instalar as dependências, compilar o projeto e disponibilizar uma URL pública.
5. Acesse a URL gerada (ex.: `https://seu-app.vercel.app`) para visualizar o dashboard e o painel admin. O login utiliza as credenciais definidas em `ADMIN_USERNAME` e `ADMIN_PASSWORD`.

## 8. Uso do sistema

### Dashboard público
Qualquer visitante acessando a raiz (`/`) do site verá a classificação atual. A tabela mostra posição, nome, rating (pontuação Elo), percentual de vitórias, média de pontos, número de partidas e variação de rating nas últimas 10 partidas. O gráfico permite comparar a evolução do rating de múltiplos jogadores: selecione os nomes no campo multi‑seleção para traçar suas curvas.

### Painel administrativo
O caminho `/admin` exige autenticação. Informe o usuário e senha definidos em `ADMIN_USERNAME` e `ADMIN_PASSWORD`. Após logado, você pode:

1. **Cadastrar jogador:** inserir apenas o nome. O rating inicial é sempre 1000.
2. **Registrar partida:** escolha a data, selecione dois ou mais jogadores, informe os pontos de cada um e clique em **Salvar partida**. Isso cria registros na tabela `match_entries` e recalcula o Elo (utilizando a função `computeMatchDeltas`). O dashboard será atualizado automaticamente.
3. **Encerrar sessão:** o botão de logout não é necessário porque o cookie expira após 12 horas; basta fechar o navegador ou deletar o cookie.

## 9. Considerações finais

- **Chaves de API e segurança:** A chave `service_role` possui acesso de escrita total ao banco e deve permanecer apenas no servidor. Não prefixe com `NEXT_PUBLIC_` para evitar exposição inadvertida【694929286118163†L94-L171】.
- **Variáveis com prefixo `NEXT_PUBLIC_`:** Apenas informações que precisam ser lidas pelo frontend devem usar esse prefixo. A documentação do Vercel ressalta que as variáveis de ambiente são acessadas via `process.env` e variáveis com prefixo `NEXT_PUBLIC_` serão expostas ao navegador【694929286118163†L94-L171】.
- **SQL Editor:** O Supabase Studio oferece um editor SQL integrado. Para executar o script de criação de tabelas basta abrir o **SQL editor**, clicar em **New Query**, colar o SQL e clicar em **Run**【763559808751294†L183-L192】.
- **Redeploys:** qualquer alteração nas variáveis de ambiente ou no código exige um novo deploy na Vercel para ter efeito. O painel da Vercel permite redeploy manual em “Deployments”.

Seguindo estas instruções, você terá o sistema de rating de 7 Wonders funcionando em produção, com banco de dados persistente no Supabase, deploy automático pelo Vercel e painel admin seguro.