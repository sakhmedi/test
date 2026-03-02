"""
End-to-end smoke test for Day 2 — DocuFlow AI.

Run from inside Docker or with a local Python env that has httpx installed:
    python test_day2.py

# FIXED: added register + login steps to obtain a Bearer token;
#        all protected routes now send Authorization header;
#        removed erroneous company_id params (derived from JWT by server).
"""

import os
import sys
import time
import tempfile

import httpx

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

TEST_EMAIL = "smoketest@example.com"
TEST_PASSWORD = "SmokeTest_password1!"
TEST_COMPANY = "Smoke Test Corp"

SAMPLE_TEXT = """
Қазақстан Республикасы — Орталық Азиядағы мемлекет.
Астанасы — Астана қаласы.
Елдің ресми тілдері: қазақ және орыс тілдері.
Халқының саны шамамен 19 миллион адам.

Казахстан обладает богатыми запасами природных ресурсов,
включая нефть, природный газ, уголь, уран и цветные металлы.
Страна входит в число крупнейших мировых производителей урана.

The Republic of Kazakhstan was officially recognized as an independent state
following the dissolution of the Soviet Union in December 1991.
"""


def step(label: str) -> None:
    print(f"\n{'='*60}\n  {label}\n{'='*60}")


def check(resp: httpx.Response, label: str) -> dict:
    if resp.status_code >= 400:
        print(f"[FAIL] {label}: HTTP {resp.status_code} — {resp.text}")
        sys.exit(1)
    data = resp.json()
    print(f"[OK]   {label}: {data}")
    return data


def main() -> None:
    client = httpx.Client(base_url=BASE_URL, timeout=120)

    # ── Health check ──────────────────────────────────────────────
    step("Health check")
    check(client.get("/health"), "GET /health")

    # ── Register (or re-use existing account) ─────────────────────
    step("Register / login to obtain Bearer token")
    reg_resp = client.post(
        "/auth/register",
        json={"company_name": TEST_COMPANY, "email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    if reg_resp.status_code == 409:
        # Email already registered — fall back to login
        print("[INFO] Email already exists, logging in instead.")
        login_resp = client.post(
            "/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        auth_data = check(login_resp, "POST /auth/login")
    else:
        auth_data = check(reg_resp, "POST /auth/register")

    token = auth_data["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    print(f"[INFO] Authenticated as {TEST_EMAIL}")

    # ── Create a temp text file ───────────────────────────────────
    step("Create sample document")
    with tempfile.NamedTemporaryFile(
        suffix=".pdf", delete=False, mode="w", encoding="utf-8"
    ) as f:
        f.write(SAMPLE_TEXT)
        tmp_path = f.name

    print(f"Temp file: {tmp_path}")

    # ── Upload document ───────────────────────────────────────────
    step("POST /api/documents/upload")
    with open(tmp_path, "rb") as f:
        resp = client.post(
            "/api/documents/upload",
            files={"file": ("sample_kz_ru.pdf", f, "application/pdf")},
        )
    upload_data = check(resp, "upload")
    doc_id = upload_data.get("id")

    # ── List documents ────────────────────────────────────────────
    step("GET /api/documents/")
    check(client.get("/api/documents/"), "list documents")

    # ── Wait for async RAGFlow indexing ───────────────────────────
    step("Waiting 10 s for RAGFlow async indexing…")
    time.sleep(10)

    # ── Chat ──────────────────────────────────────────────────────
    step("POST /api/chat")
    chat_resp = client.post(
        "/api/chat",
        json={"question": "Какова столица Казахстана и сколько там жителей?"},
    )
    chat_data = check(chat_resp, "chat")
    print("\nAnswer:", chat_data.get("answer"))
    print("Sources:", chat_data.get("sources"))

    # ── Chat history ──────────────────────────────────────────────
    step("GET /api/chat/history")
    check(client.get("/api/chat/history"), "chat history")

    # ── Cleanup: delete the uploaded document ─────────────────────
    if doc_id:
        step(f"DELETE /api/documents/{doc_id}")
        check(client.delete(f"/api/documents/{doc_id}"), "delete document")

    os.unlink(tmp_path)
    print("\n[PASS] All steps completed successfully.")


if __name__ == "__main__":
    main()
