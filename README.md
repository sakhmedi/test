# Shart AI

> B2B Document AI assistant — RAG-powered chatbot for your company's knowledge base.

Upload PDFs, Word docs, and images, then chat with them using retrieval-augmented generation (Milvus + FastAPI). Full auth, OCR, speech-to-text, and reranking included.

---

## Quick Start

```bash
# 1. Copy the env template and fill in your passwords / API keys
cp .env.example .env

# 2. Build and start all services
docker-compose up --build -d

# 3. Check service status
docker-compose ps

# 4. Verify the backend health endpoint
curl http://localhost:8000/health

# 5. Open the frontend
open http://localhost:3000
```

---

## Auth Flow

All API endpoints (except `/auth/register` and `/auth/login`) require a JWT Bearer token.

```bash
# Register your company (creates first admin user)
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Acme Corp","email":"admin@acme.com","password":"secret123"}'
# → {"access_token": "<jwt>", "token_type": "bearer"}

# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","password":"secret123"}'
# → {"access_token": "<jwt>", "token_type": "bearer"}

# Use the token in subsequent requests
TOKEN="<jwt from above>"

# Upload a document
curl -X POST http://localhost:8000/api/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@report.pdf"

# Ask a question
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the key findings?"}'

# Transcribe audio
curl -X POST http://localhost:8000/api/speech/transcribe \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@recording.wav"
```

---

## Service URLs

### Local (docker-compose)

| Service | URL | Description |
|---|---|---|
| **Frontend** | http://localhost:3000 | React SPA (Vite + Tailwind) |
| **Backend API** | http://localhost:8000 | FastAPI — docs at `/docs` |
| **Elasticsearch** | http://localhost:9200 | Full-text search (not yet queried) |
| **PostgreSQL** | localhost:5432 | Relational DB |
| **Redis** | localhost:6379 | Cache / task queue |

### School-hosted (remote)

| Service | URL | Description |
|---|---|---|
| **MinIO S3** | a1-s3-1.alem.ai (TLS) | Object storage for uploaded files |
| **Milvus** | a1-milvus1.alem.ai:30130 | Vector database (pymilvus) |
| **RAGFlow** | https://a1-ragflow1.alem.ai | Document AI engine (client ready, not active) |
| **Langfuse** | https://a1-langfuse1.alem.ai | LLM tracing & observability |

---

## School Infrastructure

All infrastructure below is hosted by Alem AI — no local installation needed.

| Resource | URL |
|---|---|
| **Langfuse** | https://a1-langfuse1.alem.ai |
| **RAGFlow** | https://a1-ragflow1.alem.ai |
| **MinIO S3** | a1-s3-1.alem.ai (bucket: `salimakolbasenko`) |
| **Milvus** | a1-milvus1.alem.ai:30130 (db: `kolbasenkosalima`) |
| **GitLab** | https://a1-gitlab3.alem.ai/sakhmedi/shartai |

**Langfuse setup (one-time):**
1. Log in at https://a1-langfuse1.alem.ai
2. Create a project → go to **Settings → API Keys**
3. Copy the **Secret Key** and **Public Key**
4. Paste them into your `.env` as `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY`

**Push to school GitLab:**
```bash
bash migrate_to_gitlab.sh   # adds 'school' remote
git push school main
```

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│  (React/    │     │  (FastAPI)   │     └──────────────┘
│   nginx)    │     └──────┬───────┘     ┌──────────────┐
└─────────────┘            │────────────▶│    Redis     │
                           │             └──────────────┘
                           │
              ┌────────────┼──────────────────────┐
              │            │                      │
    ┌─────────▼──┐  ┌──────▼──────┐    ┌──────────▼───┐
    │  MinIO S3  │  │   Milvus    │    │  Alem.ai APIs│
    │ (school,   │  │ (school,    │    │  LLM / Embed │
    │  TLS)      │  │  pymilvus)  │    │  OCR / STT   │
    └────────────┘  └─────────────┘    │  Reranker    │
                                       │  Langfuse    │
                                       └──────────────┘
```

---

## Project Structure

```
shart/
├── docker-compose.yml          # Full service stack
├── .env.example                # Environment variable template
├── postgres-init/
│   └── init.sql                # Creates langfuse + n8n databases
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                 # FastAPI app, CORS, /health, startup
│   ├── database.py             # SQLAlchemy engine + session
│   ├── models.py               # Company, User, Document, ChatSession, ChatMessage
│   ├── auth_utils.py           # JWT helpers, get_current_user dependency
│   ├── llm.py                  # AlemLLM client (OpenAI-compatible)
│   ├── routers/
│   │   ├── auth.py             # POST /auth/register, /auth/login
│   │   ├── documents.py        # Upload/list/delete with OCR support
│   │   ├── chat.py             # RAG chat with Langfuse tracing + reranking
│   │   └── speech.py           # POST /api/speech/transcribe
│   └── services/
│       ├── milvus_store.py     # pymilvus vector store (remote Milvus)
│       ├── minio_client.py     # MinIO S3 wrapper (remote, TLS)
│       ├── ragflow_client.py   # RAGFlow dataset + document API
│       ├── ocr_client.py       # Image/scanned PDF → text
│       ├── stt_client.py       # Audio → text (Kazakh STT)
│       └── reranker_client.py  # Relevance reranking of RAG chunks
└── frontend/
    ├── Dockerfile              # Multi-stage: node build → nginx serve
    ├── nginx.conf              # SPA routing + /api /auth proxy
    ├── package.json            # React 18, React Router 6, Axios, Tailwind
    ├── vite.config.js
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx             # Routes: /login /register /documents /chat
        ├── api.js              # Axios + Bearer token interceptor
        ├── context/
        │   └── AuthContext.jsx # Token + companyId state, login/logout
        ├── pages/
        │   ├── LoginPage.jsx
        │   ├── RegisterPage.jsx
        │   ├── DocumentsPage.jsx
        │   └── ChatPage.jsx
        └── components/
            ├── ProtectedRoute.jsx
            ├── Header.jsx
            ├── UploadModal.jsx
            ├── MessageBubble.jsx
            ├── SourceCard.jsx
            └── VoiceButton.jsx
```
