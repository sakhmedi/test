import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# FIXED: removed plaintext admin:admin default; placeholder fails loudly if not overridden
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://change_me@postgres:5432/shart")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
