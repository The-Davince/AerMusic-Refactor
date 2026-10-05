from fastapi import APIRouter, Request

import config as cfg
from utils.log import get_log_id

router = APIRouter()


@router.get("/health")
async def health(req: Request):
    elapsed = getattr(req.state, "elapsed_ms", 0)
    return {"code": 0, "msg": "ok", "logId": get_log_id(req),
            "data": {"status": "ok", "latency": elapsed, "version": cfg.APP_VERSION, "appName": cfg.APP_NAME}}
