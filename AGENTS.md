# Guia de Desenvolvimento Agêntico — Backend (NestJS)

Este documento orienta agentes de IA trabalhando no repositório `backend/`.

---

## 🏛️ Arquitetura e Estrutura de Módulos

O backend utiliza **NestJS 11** com TypeScript estrito, estruturado com dois pontos de entrada independentes para desacoplar as características stateless da API REST das características stateful do WebSocket Collab.

```text
backend/
├── prisma/
│   ├── schema.prisma         # Schema relacional (Users, Boards, BoardMembers, Snapshots, Assets)
│   ├── migrations/           # Migrações do PostgreSQL versionadas
│   └── seed.ts               # Dados iniciais para ambiente de desenvolvimento
├── src/
│   ├── core/                 # Infraestrutura cross-cutting (Prisma, Redis, S3, Env Zod, Metrics)
│   ├── modules/
│   │   ├── auth/             # Autenticação: Argon2id, JWT de 15m, Refresh Token em cookie HttpOnly
│   │   ├── boards/           # CRUD de quadros, permissões RBAC, links de compartilhamento
│   │   ├── assets/           # Uploads de imagem, presigned URLs S3/MinIO, strip de EXIF
│   │   ├── collab/           # Gateway WebSocket (NestJS + Yjs), gestão de salas em memória
│   │   └── persistence/      # Debounced worker salvando snapshots do Y.Doc no PostgreSQL
│   ├── shared/               # FONTE DA VERDADE dos contratos (schemas Zod, protocolo, constantes)
│   ├── main.api.ts           # Ponto de entrada da API REST (Porta 3001)
│   ├── main.collab.ts        # Ponto de entrada do WebSocket Collab Server (Porta 3002)
│   └── app.module.ts         # Módulo raiz da API REST
├── test/
│   ├── unit/                 # Testes unitários rápidos e isolados (mocks)
│   ├── integration/          # Testes com Testcontainers (PostgreSQL e Redis reais em Docker)
│   └── contract/             # Testes de integridade do contrato shared contra fixtures binárias
└── scripts/
    └── gen-fixtures.ts       # Script para regerar fixtures de protocolo em caso de alteração no contrato
```

---

## ⚡ Regras Críticas para o Backend

### 1. Dual Entrypoint
- **API REST (`main.api.ts`):** Roda na porta 3001. Não mantém estado em memória. Documentação Swagger interativa em `/v1/docs` e OpenAPI JSON em `/v1/docs-json`.
- **Collab Server (`main.collab.ts`):** Roda na porta 3002. Gerencia instâncias de `Y.Doc` ativas em memória enquanto houver clientes conectados. Valida updates binários em um documento sombra antes de fazer broadcast.
- Nunca adicione estado em memória na API REST. Nunca adicione rotas REST na instância Collab.

### 2. Fonte da Verdade (`src/shared/`)
- Este diretório é a fonte canônica dos contratos compartilhados entre backend e frontend.
- Se adicionar ou alterar tipos de elementos do canvas, propriedades, schemas Zod ou mensagens de protocolo:
  1. Modifique aqui em `src/shared/`.
  2. Execute `npx tsx scripts/gen-fixtures.ts` se o protocolo ou schema mudou.
  3. No frontend, execute `npm run sync:shared` para replicar as alterações.
  4. Rode `npm run test` para validar o teste de contrato `test/contract/shared-contract.spec.ts`.

### 3. Banco de Dados e Migrações (Prisma)
- Ao alterar o `prisma/schema.prisma`:
  - Para criar nova migração: `npm run prisma:migrate` (requer Postgres ativo via `make deps`).
  - Para regenerar o cliente: `npm run prisma:generate`.
  - Para popular dados de teste: `npm run db:seed`.

### 4. Ciclo de Testes
- **Testes Unitários:** `npm run test` (roda em ~1.4s com Vitest). Execute com frequência.
- **Testes de Integração:** `npm run test:int` (utiliza Testcontainers; Docker precisa estar em execução).
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`). Deve passar sem nenhum erro.
- **Linting:** `npm run lint` (`eslint .`). Deve passar sem avisos nem erros.
