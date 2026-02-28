from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
async def register():
    """TODO Day 2: company registration + admin user creation."""
    return {"detail": "not implemented"}


@router.post("/login")
async def login():
    """TODO Day 2: JWT token issue."""
    return {"detail": "not implemented"}


@router.post("/logout")
async def logout():
    """TODO Day 2: token invalidation."""
    return {"detail": "not implemented"}
