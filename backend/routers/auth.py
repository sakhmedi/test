import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth_utils import create_token, hash_password, verify_password
from database import get_db
from models import Company, User

router = APIRouter(prefix="/auth", tags=["auth"])


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug[:60]


class RegisterRequest(BaseModel):
    company_name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str



@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: Session = Depends(get_db)):
    # Check email uniqueness
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already registered.")  # FIXED: 409 Conflict

    # Create company with a unique slug
    base_slug = _slugify(body.company_name) or "company"
    slug = base_slug
    counter = 1
    while db.query(Company).filter(Company.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1

    company = Company(name=body.company_name, slug=slug)
    db.add(company)
    db.commit()
    db.refresh(company)

    # Create admin user
    user = User(
        company_id=company.id,
        email=body.email,
        hashed_password=hash_password(body.password),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id, company.id, user.email)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/login")
async def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_token(user.id, user.company_id, user.email)
    return {"access_token": token, "token_type": "bearer"}
