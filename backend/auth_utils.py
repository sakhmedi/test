import logging
import os
from datetime import datetime, timedelta

from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

_logger = logging.getLogger(__name__)

_JWT_SECRET_DEFAULT = "change_me_jwt_secret_32_chars_min"
JWT_SECRET = os.getenv("JWT_SECRET", _JWT_SECRET_DEFAULT)

# FIXED: warn loudly at import time if the default JWT secret is still in use
if JWT_SECRET == _JWT_SECRET_DEFAULT:
    _logger.warning(
        "SECURITY WARNING: JWT_SECRET is set to the default placeholder value. "
        "Set a strong secret in your .env before running in production."
    )
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer()


def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def create_token(user_id: str, company_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "company_id": company_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
) -> dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
