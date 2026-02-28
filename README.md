# DocuFlow AI

> B2B Document AI assistant — RAG-powered chatbot for your company's knowledge base.

Built in 7 days at a hackathon. Upload PDFs and documents, then chat with them using state-of-the-art retrieval-augmented generation (RAGFlow + Milvus + FastAPI).

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

## Service URLs

| Service | URL | Description |
|---|---|---|
| **Frontend** | http://localhost:3000 | Main web UI (nginx static) |
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
│  (nginx)    │     │  (FastAPI)   │     │  (docuflow,  │
└─────────────┘     └──────┬───────┘     │  langfuse,   │
                           │             │  n8n DBs)    │
              ┌────────────┼─────────────┘──────────────┘
              │            │
    ┌─────────▼──┐  ┌──────▼──────┐  ┌──────────────┐
    │   MinIO    │  │   RAGFlow   │  │    Milvus    │
    │  (S3 docs) │  │  (RAG API)  │  │  (vectors)   │
    └────────────┘  └─────────────┘  └──────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼──┐  ┌──────▼───┐
    │   Redis    │  │ Langfuse │
    │  (cache)   │  │ (traces) │
    └────────────┘  └──────────┘
```

---

## Project Structure

```
docuflow/
├── docker-compose.yml       # Full 11-service stack
├── .env.example             # Environment variable template
├── postgres-init/
│   └── init.sql             # Creates langfuse + n8n databases
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py              # FastAPI app, CORS, /health, startup
│   ├── database.py          # SQLAlchemy engine + session
│   ├── models.py            # Company, Document, ChatSession, ChatMessage
│   └── routers/
│       ├── auth.py          # Auth endpoints (Day 2)
│       ├── documents.py     # Document upload/list (Day 3)
│       └── chat.py          # Chat sessions + messages (Day 4)
└── frontend/
    ├── Dockerfile
    └── index.html           # Coming Soon placeholder
```

---

## Hackathon Roadmap

| Day | Goal |
|-----|------|
| **Day 1** | Infrastructure setup — all services running |
| **Day 2** | Auth system — company registration, JWT login |
| **Day 3** | Document upload — MinIO storage + RAGFlow indexing |
| **Day 4** | Chat API — RAG query, session history |
| **Day 5** | Frontend UI — chat interface, document manager |
| **Day 6** | Polish — Langfuse traces, n8n automation hooks |
| **Day 7** | Demo prep, cleanup, deployment |
