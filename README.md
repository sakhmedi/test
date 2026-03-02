# DocuFlow AI

> B2B Document AI assistant — RAG-powered chatbot for your company's knowledge base.

Upload PDFs, Word docs, and images, then chat with them using retrieval-augmented generation (RAGFlow + Milvus + FastAPI). Full auth, OCR, speech-to-text, and reranking included.

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

| Service | URL | Description |
|---|---|---|
| **Frontend** | http://localhost:3000 | React SPA (Vite + Tailwind) |
| **Backend API** | http://localhost:8000 | FastAPI — docs at `/docs` |
| **MinIO Console** | http://localhost:9001 | Object storage admin |
| **RAGFlow Web** | http://localhost:8080 | Document AI engine UI |
| **RAGFlow API** | http://localhost:9380 | RAGFlow REST API |
| **Langfuse** | http://localhost:3001 | LLM tracing & observability |
| **Milvus** | localhost:19530 | Vector DB (gRPC) |
| **Elasticsearch** | http://localhost:9200 | Full-text search (used by RAGFlow) |
| **PostgreSQL** | localhost:5432 | Relational DB |
| **Redis** | localhost:6379 | Cache / task queue |

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│  (React/    │     │  (FastAPI)   │     │  (docuflow + │
│   nginx)    │     └──────┬───────┘     │   langfuse)  │
└─────────────┘            │             └──────────────┘
                           │
              ┌────────────┼─────────────┐
              │            │             │
    ┌─────────▼──┐  ┌──────▼──────┐  ┌──▼───────────┐
    │   MinIO    │  │   RAGFlow   │  │    Milvus    │
    │  (S3 docs) │  │  (RAG API)  │  │  (vectors)   │
    └────────────┘  └─────────────┘  └──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼──┐  ┌──────▼───┐  ┌────▼──────────────┐
    │   Redis    │  │ Langfuse │  │  External APIs     │
    │  (cache)   │  │ (traces) │  │  OCR / STT /       │
    └────────────┘  └──────────┘  │  Reranker / Embed  │
                                  └────────────────────┘
```

---

## Project Structure

```
docuflow/
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
│       ├── minio_client.py     # MinIO S3 wrapper
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
