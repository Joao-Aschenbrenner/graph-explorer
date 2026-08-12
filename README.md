# Graph Explorer

Aplicativo de desktop (Electron) para escanear seus projetos, gerar knowledge graphs com o [Graphify](https://github.com/anomalyco/graphify) e visualizá-los localmente — com suporte a IA para nomear comunidades, sem depender de nenhum serviço web.

## Requisitos

- Node.js 18+ (testado em Node 24)
- CLI `graphify` instalado (pacote oficial `graphifyy`). O app detecta automaticamente via `graphify --version` e `--help`.
- Windows (o app foi testado em Windows; o código também roda em macOS/Linux via Electron)

## Instalação e execução

```bash
npm install
npm start
```

Ou no Windows, use `iniciar.bat` (mata instâncias antigas e abre o app).

### Atualizações automáticas

- Instale uma vez usando `Graph-Explorer-Setup-*.exe`.
- Ao abrir, o app verifica o release mais recente no GitHub e baixa em segundo plano.
- Ao fechar, a atualização baixada é instalada automaticamente. A próxima abertura já usa a nova versão.
- O canto superior direito mostra a versão e o estado do download; clique no badge para verificar manualmente.
- A versão portátil não se autoatualiza; use o instalador `Setup` para habilitar esse fluxo.

## Como usar

1. **Selecione a pasta de projetos** — o app escaneia a pasta e lista os repositórios/projetos (detecta `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Dockerfile`, etc.).
2. **Gere o grafo** de um projeto — executa `graphify extract` (árvore sintática) + `graphify cluster-only` (comunidades). A geração é assíncrona: dá para cancelar e o app não congela.
3. **Visualize** — o `graphify-out/graph.html` de cada projeto é aberto em um `webview` isolado (sandbox, sem Node, partition própria).
4. **Nomeie comunidades com IA** (opcional) — configure um provedor de IA e use a ação "Nomes".

## Provedores de IA

- Análise local **não precisa de chave** (modo "Sem IA").
- OpenAI, Anthropic/Claude, Gemini, DeepSeek, Kimi, Ollama (local), Azure OpenAI, AWS Bedrock, NVIDIA NIM, OpenRouter, Groq, LM Studio, vLLM e qualquer endpoint OpenAI-compatível (Custom).
- **Segurança da chave**: com `sessionOnly`, a chave fica só na memória da sessão; sem `sessionOnly`, ela é criptografada com `safeStorage` do Electron e gravada como `encryptedCredential` (nunca em texto puro). A chave nunca aparece nos logs.

## Estrutura

```
main.js           processo principal (IPC, scan, jobs de graphify, safeStorage)
preload.cjs       bridge IPC com contextIsolation + sandbox
public/index.html UI (splash, setup, sidebar, webview, modais)
assets/           ícones e logo
ge-qa-full.mjs    suíte QA funcional (30 gates) — isolada via GE_CONFIG_DIR
```

## Qualidade

- 30 gates funcionais de QA cobrem: primeira execução com todos os provedores, versão/update API visíveis, startup/boot real, scan de workspace, geração/cancelamento/retomada de jobs, rejeição de chave inválida, validação de chave+modelo+inferência, contrato completo de save, fluxo `Salvar e abrir`, reutilização segura da credencial criptografada, credenciais de sessão vs persistidas, modo sem IA, isolamento do webview, cópia de prompt, ausência de porta 3456, ausência de caminhos hardcoded e zero processos órfãos.
- O QA roda com diretório de configuração temporário (`GE_CONFIG_DIR`) e nunca toca o `config.json` real.

## Segurança

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Webview de visualização com `sandbox=yes, contextIsolation=yes, nodeIntegration=no` e `partition` própria.
- Nenhuma porta de rede é aberta pelo app.
